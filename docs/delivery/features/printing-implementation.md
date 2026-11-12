# D04–D05 / C07 打印与服务端草稿

2026-11-12。本地实现；未提交、推送、部署或执行正式迁移。未修改 `dashboard.tsx`、`lib/word-source.ts`；这两个文件中的并行修改由各自负责人集成。

## 打印契约

- `MistakePrintOptions.imageWidthMm`：60–165 mm，最多一位小数，默认 160。旧调用可省略；`printOptionsParams` 和 `parseMistakePrintOptions` 前后端共用，重复、越界和无效参数拒绝。12/14 pt 仅控制文字，图片中的字由物理宽度控制。
- `printImageRegion(width, height, questionBounds)`：沿用千分比 `[left, top, right, bottom]`，四边各加 12/1000 安全边距，与既有浏览器裁剪规则一致。无合法题框保留整页并提示核对。归档仍使用 `mistakes.question_bounds`，不改写 OCR 坐标。
- `printImageSegments`：保持选定宽度；每段最多约 220 mm 高，边界以 OOXML 十万分比取整，首尾完整、相邻分段连续。每张源图只嵌入一次；`a:srcRect` 组合题框和纵向分段裁剪。最多 500 段，极端比例直接报错，不缩成单页。
- 超长图的每段使用真实 `w:pageBreakBefore` 强制另起页，标明题号和分段号；剪贴版长图移出表格以避免 Word 忽略表内分页设置。保留裁剪线、20 mm 四边留白、错因三行、字号、类似题开关、原顺序和集中另起页的答案。
- `archiveKind: "collection"`、`judgementSource: "manual"`、`visualQuestion: true` 或题干标记“原图题目/见题图”而未提供 `sourceImage` 时，生成器直接报错，避免把纯图片题导出成空白文字。源图片不可读同样报错。
- `requiresPrintImage(item)` 导出给调用方准备图片，包含数学、图形、计算题及人工归档的原图题；调用方应在生成前按此条件读取原图。API/图片读取端仍需执行账号和档案鉴权。

`WorksheetMistake` 新增 `questionBounds?: number[]`。推荐两条导出路径统一传入原始 JPG/PNG 的 `{ bytes, width, height, fullPage: true, mime }` 和归档题框，让生成器做同一套 `srcRect` 裁剪；无需 canvas 缩小或重编码。已经裁剪的图片传 `fullPage: false`，不再二次裁剪。旧浏览器 canvas 路径会舍入像素并压到最长边 1600 px；若继续沿用，需要给预览传实际准备后的 `printImage`，不能把原图预览声称为该重编码结果的精确预览。

## 预览及实际分页边界

`PrintSettings.items` 接受完整 Mistake（至少 `id/question/subject`；图片需要 `uploadId/pageNumber/questionBounds`，也支持 `incorrectAnswer/sourceName/visualQuestion/archiveKind/judgementSource`）。全部 manual/collection 题均强制原图，不依赖题干关键词或 visualQuestion。面板读取鉴权原图实际尺寸，展示宽高 mm、题框裁剪、分段数、各段尺寸和 A4 纸张/20 mm 页边距边界。`printImage?: { url, width, height, fullPage }` 可覆盖为父组件实际导出使用的图片。预览与 DOCX 共用 `printImageRegion` / `printImageSegments`。

长图框中的“强制另起页”与 Word 写入的分页标记对应；参考答案也明确强制另起页。预览没有伪造完整文档页码：题干、错因、类似题、短图的自然分页仍受 Word/WPS 字体和排版引擎影响。完整文档的**实际分页与页码须在下载后用 Word/WPS 打印预览核验**。浏览器图框是物理尺寸缩略图，不声称屏幕 mm 等于实物尺量。

## 草稿 API

`GET /api/drafts/printing?profileId=<当前档案ID>` 返回：

```ts
{ profileId: string, draft: null | {
  key: string, profileId: string, version: number,
  payload: WorkspaceDraftPayload, updatedAt: string
} }
```

`PUT` 同一路径，JSON 请求体：

```ts
{
  version: number, // 首次为 0；后续必须使用最后一次 GET/PUT 返回值
  payload: {
    schemaVersion: 1,
    print?: { itemIds: string[], options: MistakePrintOptions },
    reflections?: Record<string, string>
  }
}
```

成功返回 `{ profileId, draft }`。PUT 为**整个 payload 替换**，通用调用方更新某部分时保留其他部分。`reflections` 是未提交学生文字，不会写入正式 reflection，也不会覆盖 AI 解析；仍须调用原错因保存接口完成提交。最多 500 个选题/500 条错因，每条错因 1000 Unicode 字符；ID 唯一、payload 严格校验，请求最大 2 MB。

认证用 `authenticate`；档案用 `const profile = await requireProfile(userId, requestedProfileId)`，读取其 `profile.id`。显式 profileId 经过该函数验证账号归属，不信任客户端声明。所有 SQL 同时限定 user/profile/key，保存时校验 payload 引用的错题归属。请求创建时固定 profileId，不依赖之后可能切换的 cookie。401 未登录，403 档案不属于账号，400 格式错误，413 过大，422 引用了不可访问/已不存在题目，503 存储失败；均不缓存。

原子 INSERT `ON CONFLICT DO NOTHING` 处理 version=0 并发首次保存；UPDATE 的 WHERE 同时检查 version，成功 version+1。落后版本和首次写入竞争返回 **409**，不覆盖现有草稿。客户端须保留当前编辑，重新 GET，由用户选择恢复或保留当前清单后再按新 version 保存，不能自动强制覆盖。

通用 key 路由为 `/api/drafts/[key]`，key 限小写字母开头、字母数字和短横线、最长 64。迁移 `0011_workspace_drafts.sql` 依赖 0008 的 `learning_profiles`、复合外键和 `preserve_learning_owner`，沿用启用账号触发器。`db/draft-schema.ts` 是独立 Drizzle 表定义，整合者需在主 schema 导出，避免未来生成迁移误删表。本轮未修改主 schema 或运行迁移。

## 父 dashboard 集成

推荐父组件常驻 hook，使刷新能主动恢复并打开打印面板，关闭面板不丢失自动保存上下文。**不要同时启动父 hook 与面板自己的草稿读写。**

```tsx
import { PrintSettings, usePrintWorkspaceDraft } from "./mistake-printing";

// 档案容器使用 key={profile.id}；切换前等待保存，或明确提示尚未保存。
// 错题列表加载完之后才提供 profileId，避免恢复 ID 被尚未加载的空列表过滤。
const printingDraft = usePrintWorkspaceDraft({
  profileId: loadingMistakes ? undefined : profile.id,
  items: printItems, // 按 printIds 的顺序映射完整 Mistake，不能按列表顺序重新 filter
  options: printOptions,
  onItems: ids => { setPrintIds(ids); setPrintOpen(true); },
  onOptions: setPrintOptions,
  reflections: reflectionDraftValues, // 可选：只传学生未提交文字
  onReflections: restoreReflectionDraftValues, // 可选：恢复到原错因编辑状态
});

// 原来的 onGenerate/busy/unsaved/onSaveDrafts 等 props 保留。
// 在原有 PrintSettings 上添加：
// draftController={printingDraft}
// items={printItems} options={printOptions}
// onItems={...同一受控回调...} onOptions={setPrintOptions}
```

建议把 `printOpen` 和待导出清单分开；关闭只改可见性。若保留旧的 `printIds === null` 表示关闭，hook 不会自动保存空清单，但仍建议保留最近一次清单供常驻 hook 使用。恢复清单可能包含被其他页面删除的题，父组件需显示缺失提示并让用户重新确认；不要悄悄过滤成空数组后回写。

恢复策略：服务端非空且父状态未被用户改变、当前清单为空时，自动调用 `onItems` / `onOptions`（和可选 `onReflections`）；当前已选题时显示选择，不静默替换。服务端空清单不恢复覆盖已有选择。恢复后等待父组件回传清单和设置，才允许后续保存。非空清单编辑停顿 800 ms 自动保存；加载失败、版本冲突时停止自动写入并保留当前输入。空状态从不自动写回，清空需要用户显式点击保存或自行 PUT；卸载不会后台偷偷写空数据。失败后用“重新加载草稿”解决，不能循环重试覆盖。

`printingDraft` 返回 `enabled/ready/saving/message/pending` 和 `save/reload/restore/keepCurrent`。父层可以显示保存状态、在关页前提示；`reload()` 获取远端，`restore()` 应用待恢复版本，`keepCurrent()` 按已读取版本继续保存当前选择。不要只打开面板却在父层从未挂载 hook，这无法触发刷新后的自动恢复。

只在面板内恢复时可直接传 `draftProfileId={profile.id}`，可选 `reflectionDraftValues/onRestoreReflectionDrafts`；这种方式需要父层另提供“恢复打印清单”开面板入口。不得再传另一份活跃 controller。

## 验证记录

- `node scripts/check-mistake-docx.mjs`：通过。保留原 Word 回归；新增宽度参数/草稿结构校验、图片题无原图拒绝、连续分段守恒、裁剪组合、真实 OOXML 分页标记、媒体去重检查。仅使用已有图片 fixture 和格式结构对象，不写入业务资料。
- 本任务文件定向 ESLint：通过。
- `npx tsc --noEmit`：当前整仓有并行开发文件错误；本任务文件未出现错误。最终整仓结果以整合后的检查为准。
- `npm run build`：原目录 `dist/client` 被其他预览进程占用，EBUSY；未终止别人的进程。隔离源码副本构建首次因并行 dashboard 尚缺 `today-tasks` 模块失败。用户已接手 `work/requirements-build` 独立构建，本任务不再重复构建或操作预览进程。
- 尚未执行草稿正式迁移、真实账号跨档案 API/409 联调、浏览器端恢复交互验收、Word/WPS 打开和实际打印机纸面验收。结构校验不代替这些验收，不声称 D06 完成。


## 整合验收更新

原工作流验证记录保留当时状态。最终整合的类型检查、ESLint、隔离五阶段构建、Workers HTTP、浏览器及持久任务证据与边界，以[全量实施与验证](requirements-implementation.md)为准；本地实现未发布。
