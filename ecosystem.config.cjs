// DATABASE_URL、DeepSeek API Key 与 SESSION_SECRET 存放于 .dev.vars（权限 600），
// 由 Wrangler 的 --env-file 在启动时加载。
// vinext/Workers 通过 Wrangler 本地运行，业务数据库连接真实 PostgreSQL；
// R2 图片数据持久化在 /opt/shiti-mistake-notebook/.wrangler/state。
module.exports = {
  apps: [{
    name: 'shiti-notebook',
    script: '/root/.nvm/versions/node/v24.18.0/bin/node',
    interpreter: 'none',
    args: [
      '--import', './scripts/sites-env.mjs',
      './node_modules/wrangler/bin/wrangler.js', 'dev',
      '--config', 'dist/server/wrangler.json',
      '--local',
      '--persist-to', '.wrangler/state',
      '--ip', '127.0.0.1',
      '--port', '3105',
      '--inspector-port', '0',
      '--env-file', '/opt/shiti-mistake-notebook/.dev.vars',
    ].join(' '),
    cwd: '/opt/shiti-mistake-notebook',
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Shanghai',
      PATH: '/root/.nvm/versions/node/v24.18.0/bin:' + process.env.PATH,
    },
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
  }],
};
