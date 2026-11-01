#!/usr/bin/env bash
# 服务器更新：PostgreSQL 保存业务数据，Wrangler 本地运行 Workers 与 R2。
set -euo pipefail

REPO=/opt/shiti-mistake-notebook
NODE_BIN=/root/.nvm/versions/node/v24.18.0/bin
PORT=3105
export PATH="$NODE_BIN:$PATH"
cd "$REPO"

fail() { printf '  失败：%s\n' "$1"; exit 1; }
pass() { printf '  通过：%s\n' "$1"; }

printf '==> 拉取最新代码\n'
# 拉取代码可能更新正在执行的脚本，更新后重新执行完整文件。
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
before="$(sha256sum "$SELF" | cut -d' ' -f1)"
git pull --ff-only
git log --oneline -1
after="$(sha256sum "$SELF" | cut -d' ' -f1)"
if [ "$before" != "$after" ]; then
  [ "${SHITI_DEPLOY_REEXEC:-}" != "1" ] || fail "部署脚本连续发生变化"
  export SHITI_DEPLOY_REEXEC=1
  exec bash "$SELF"
fi

printf '==> 检查部署配置\n'
for file in .dev.vars .deploy.vars; do
  [ -f "$REPO/$file" ] || fail "缺少 $file"
  chmod 600 "$REPO/$file"
done
set -a
. "$REPO/.dev.vars"
. "$REPO/.deploy.vars"
set +a
[ -n "${DATABASE_URL:-}" ] || fail ".dev.vars 缺少 DATABASE_URL"
[ -n "${SESSION_SECRET:-}" ] || fail ".dev.vars 缺少 SESSION_SECRET"
[ "${#SESSION_SECRET}" -ge 32 ] || fail "SESSION_SECRET 短于 32 字符"
[ "${TRUST_OAI_HEADERS:-}" != "1" ] || fail "生产环境禁止 TRUST_OAI_HEADERS=1"
for key in SHITI_BOOTSTRAP_USER SHITI_BOOTSTRAP_PASSWORD SHITI_DEFAULT_USER SHITI_DEFAULT_PASSWORD; do
  [ -n "${!key:-}" ] || fail ".deploy.vars 缺少 $key"
done

printf '==> 安装依赖\n'
npm run install:ci
printf '==> 构建\n'
npm run build
[ -f dist/server/index.js ] || fail "构建产物 dist/server/index.js 缺失"
[ -f dist/server/wrangler.json ] || fail "构建产物 wrangler.json 缺失"

printf '==> 应用 PostgreSQL 迁移\n'
node scripts/migrate-postgres.mjs
printf '==> 初始化并核对真实账号\n'
node scripts/seed-default-accounts.mjs

# 明文登录凭据只用于部署验证，不传入 PM2 应用进程。
ADMIN_USER="$SHITI_BOOTSTRAP_USER"
ADMIN_PASSWORD="$SHITI_BOOTSTRAP_PASSWORD"
USER_NAME="$SHITI_DEFAULT_USER"
USER_PASSWORD="$SHITI_DEFAULT_PASSWORD"
unset SHITI_BOOTSTRAP_PASSWORD SHITI_DEFAULT_PASSWORD

printf '==> 重启应用\n'
if pm2 describe shiti-notebook > /dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --only shiti-notebook --update-env
else
  pm2 start ecosystem.config.cjs --only shiti-notebook
fi

printf '==> 等待就绪\n'
ready=0
for _ in $(seq 1 30); do
  if code=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$PORT/api/status"); then
    if [ "$code" = "200" ]; then ready=1; break; fi
  fi
  sleep 2
done
[ "$ready" = "1" ] || fail "应用未在 60 秒内就绪"

umask 077
mkdir -p "$REPO/work"
CHECK_DIR="$(mktemp -d "$REPO/work/deploy-verify.XXXXXX")"
cleanup() { rm -f "$CHECK_DIR/body.json" "$CHECK_DIR/admin.cookies" "$CHECK_DIR/user.cookies"; rmdir "$CHECK_DIR"; }
trap cleanup EXIT
BASE="http://127.0.0.1:$PORT"
expect_code() {
  local expected="$1" path="$2" actual
  shift 2
  actual=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$@" "$BASE$path")
  [ "$actual" = "$expected" ] || fail "$path 返回 $actual，应为 $expected"
  pass "$path 返回 $expected"
}

printf '==> 验证状态与权限\n'
status=$(curl --silent --show-error --fail "$BASE/api/status")
printf '%s' "$status" | node -e 'let text="";process.stdin.on("data",part=>text+=part);process.stdin.on("end",()=>{if(JSON.parse(text).aiConfigured!==true)throw new Error("DeepSeek 密钥未生效")})'
pass "/api/status 配置有效"
expect_code 200 /
expect_code 200 /login
expect_code 200 /register
expect_code 401 /api/mistakes
expect_code 401 /api/admin/users
expect_code 401 /api/mistakes -H "oai-authenticated-user-id: ${SHITI_BOOTSTRAP_ID:-shiti}"

login() {
  local username="$1" password="$2" jar="$3"
  SHITI_LOGIN_USER="$username" SHITI_LOGIN_PASSWORD="$password" node -e 'process.stdout.write(JSON.stringify({username:process.env.SHITI_LOGIN_USER,password:process.env.SHITI_LOGIN_PASSWORD}))' > "$CHECK_DIR/body.json"
  expect_code 200 /api/auth/login -c "$jar" -H 'Content-Type: application/json' --data-binary "@$CHECK_DIR/body.json"
}
login "$ADMIN_USER" "$ADMIN_PASSWORD" "$CHECK_DIR/admin.cookies"
login "$USER_NAME" "$USER_PASSWORD" "$CHECK_DIR/user.cookies"
expect_code 200 /api/mistakes -b "$CHECK_DIR/admin.cookies"
expect_code 200 /api/mistakes -b "$CHECK_DIR/user.cookies"
expect_code 200 /api/admin/users -b "$CHECK_DIR/admin.cookies"
expect_code 403 /api/admin/users -b "$CHECK_DIR/user.cookies"
expect_code 200 /admin -b "$CHECK_DIR/admin.cookies"
expect_code 307 /admin -b "$CHECK_DIR/user.cookies"

printf '==> 部署完成\n'
