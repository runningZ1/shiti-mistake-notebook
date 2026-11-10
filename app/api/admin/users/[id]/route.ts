import { env } from "cloudflare:workers";
import { authenticateAdmin } from "@/lib/api-guard";
import { hashPassword } from "@/lib/auth";
import { checkDisplayName, checkPassword, checkWechat, normalizeWechat } from "@/lib/credentials";
import {
  abortUserImageUploads,
  beginUserDeletion,
  deleteUserRows,
  findUserById,
  listUploadFileKeys,
  updateUser,
} from "@/lib/users";

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;
  const admin = auth.user;
  const { id } = await params;

  let body: {
    displayName?: unknown;
    role?: unknown;
    status?: unknown;
    password?: unknown;
    wechat?: unknown;
    trialAction?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("请求格式不正确", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail("请求格式不正确", 400);
  }
  const fields = Object.keys(body);
  const allowedFields = ["displayName", "role", "status", "password", "wechat", "trialAction"];
  if (fields.length === 0) return fail("请提供需要更新的字段", 400);
  if (fields.some((field) => !allowedFields.includes(field))) return fail("请求包含未知字段", 400);
  if (body.displayName !== undefined && typeof body.displayName !== "string") return fail("昵称格式不正确", 400);
  if (body.role !== undefined && body.role !== "user" && body.role !== "admin") return fail("账号角色不正确", 400);
  if (body.status !== undefined && body.status !== "active" && body.status !== "disabled") return fail("账号状态不正确", 400);
  if (body.password !== undefined && typeof body.password !== "string") return fail("密码格式不正确", 400);
  if (body.wechat !== undefined && typeof body.wechat !== "string") return fail("微信号格式不正确", 400);


  let target;
  try {
    target = await findUserById(id);
  } catch {
    return fail("存储服务暂不可用", 503);
  }
  if (!target) return fail("账号不存在", 404);

  const isSelf = id === admin.userId;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : null;
  const role = body.role === "admin" ? "admin" : body.role === "user" ? "user" : null;
  const status = body.status === "active" ? "active" : body.status === "disabled" ? "disabled" : null;
  const password = typeof body.password === "string" ? body.password : null;
  // 没传这个字段就不动；传空串表示清空
  const wechat = typeof body.wechat === "string" ? normalizeWechat(body.wechat) : null;
  const trialAction = body.trialAction === "extend7" || body.trialAction === "unlimited" ? body.trialAction : null;
  if (body.trialAction !== undefined && trialAction === null) return fail("试用期操作不正确", 400);

  if (displayName !== null) {
    const invalid = checkDisplayName(displayName);
    if (invalid) return fail(invalid, 400);
    if (!displayName) return fail("昵称不能为空", 400);
  }
  if (password !== null) {
    const invalid = checkPassword(password);
    if (invalid) return fail(invalid, 400);
  }
  if (wechat !== null) {
    const invalid = checkWechat(wechat, false);
    if (invalid) return fail(invalid, 400);
  }

  // 禁止停用或降级自己，数据库同时保护最后一个启用管理员。
  if (isSelf && role === "user") return fail("不能取消自己的管理员权限", 400);
  if (isSelf && status === "disabled") return fail("不能停用自己的账号", 400);

  try {
    const passwordHash = password === null ? undefined : await hashPassword(password);
    const result = await updateUser(id, {
      displayName: displayName ?? undefined,
      role: role ?? undefined,
      status: status ?? undefined,
      passwordHash,
      wechat: wechat ?? undefined,
      trialAction: trialAction ?? undefined,
    });
    if (result === "not-found") return fail("账号不存在", 404);
    if (result === "deleting") return fail("账号正在删除，无法修改，请继续重试删除", 409);
    if (result === "unlimited") return fail("此账号已长期可用，无需延长试用期", 400);
    if (result === "last-admin") {
      return fail(role === "user" ? "这是最后一个管理员，不能降级" : "这是最后一个启用管理员，不能停用", 400);
    }
  } catch {
    return fail("更新失败，请稍后重试", 503);
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAdmin();
  if ("response" in auth) return auth.response;
  const admin = auth.user;
  const { id } = await params;

  if (id === admin.userId) return fail("不能删除自己的账号", 400);

  let target;
  try {
    target = await findUserById(id);
  } catch {
    return fail("存储服务暂不可用", 503);
  }
  if (!target) return fail("账号不存在", 404);

  // 在任何图片操作前原子标记删除并停用账号，标记保留供失败后重试。
  try {
    const reserved = await beginUserDeletion(id);
    if (reserved === "not-found") return fail("账号不存在", 404);
    if (reserved === "last-admin") return fail("这是最后一个启用管理员，不能删除", 400);
  } catch {
    return fail("标记账号删除失败，未执行图片删除，请稍后重试", 503);
  }

  // 先读取完整图片索引，再删除 R2 对象，最后清理数据库记录。
  let keys: string[] = [];
  try {
    await abortUserImageUploads(id);
    keys = await listUploadFileKeys(id);
  } catch {
    return fail("读取上传记录失败，账号已停用且未删除，请稍后重试", 503);
  }

  if (keys.length > 0) {
    if (!env.BUCKET) return fail("图片存储未绑定，账号已停用且未删除，请配置后重试", 503);
    try {
      for (let offset = 0; offset < keys.length; offset += 1000) {
        await env.BUCKET.delete(keys.slice(offset, offset + 1000));
      }
    } catch {
      // 这里中止是有意的：R2 删不掉就把账号留着，管理员可以重试。
      // 继续删库会留下永远清不掉的孤儿图片，而且再也没人知道它们属于谁。
      return fail("删除图片失败，账号已停用且未删除，请稍后重试", 503);
    }
  }

  try {
    const deleted = await deleteUserRows(id);
    if (!deleted) {
      const current = await findUserById(id);
      if (!current) return fail("账号不存在", 404);
      return fail("账号删除状态不正确，未清理数据库记录，请稍后重试", 409);
    }
  } catch {
    return fail("删除账号失败，账号已停用且记录已保留，请稍后重试", 503);
  }

  return Response.json(
    { ok: true, deletedImages: keys.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
