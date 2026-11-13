import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { request, closeTestProfile } from './native-request.mjs';

// 只使用虚构账号与临时配置，观察首个请求和页面脚本实际读到的登录数据。
let firstCookie;
let finish;
const reported = new Promise((resolve) => { finish = resolve; });
let finishReload;
const reloaded = new Promise((resolve) => { finishReload = resolve; });
let reports = 0;
let reopened;
const openedAgain = new Promise((resolve) => { reopened = resolve; });
const server = http.createServer(async (req, res) => {
  if (req.url === '/report') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (++reports === 1) finish(body); else if (reports === 2) finishReload(body); else reopened(body);
    res.end('ok'); return;
  }
  firstCookie ??= req.headers.cookie || '';
  res.setHeader('Content-Type', 'text/html');
  res.end(`<title>HostDeck session fixture</title><script>
    const before = { local: localStorage.getItem('test-login'), session: sessionStorage.getItem('test-session') };
    localStorage.setItem('test-login', 'changed-after-login');
    if (!sessionStorage.getItem('reload-once')) {
      sessionStorage.setItem('reload-once', 'yes'); setTimeout(() => location.reload(), 700);
    }
    fetch('/report', {method:'POST', body:JSON.stringify(before)});
  </script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const root = path.resolve('output', 'seed-test-' + Date.now());
const env = { id: 'login-fixture', name: '本地登录测试', hosts: '127.0.0.1 session.invalid' };
const url = 'http://session.invalid:' + server.address().port + '/';
const digest = createHash('sha256').update('[{"host":"session.invalid","ip":"127.0.0.1"}]').digest('hex').slice(0,12);
const profile = path.join(root, 'HostDeck', 'profiles', env.id + '-' + digest);
const loginToken = '测试凭证'.repeat(30000);
const session = {
  cookies: [{ name: 'test-auth', value: 'fake-secret', domain: 'session.invalid', path: '/', httpOnly: true, secure: false }],
  storage: { origin: new URL(url).origin, local: [['test-login', loginToken]], session: [['test-session', 'fake-session']] },
};
try {
  const launch = () => request({ type: 'launch', environment: env, url, session }, { LOCALAPPDATA: root });
  const deadline = (promise) => Promise.race([promise, new Promise((_, reject) => {
    setTimeout(() => reject(new Error('页面未报告登录数据')), 10000).unref();
  })]);
  const result = await launch();
  assert.equal(result.profile, profile);
  const values = await deadline(reported);
  assert.match(firstCookie, /test-auth=fake-secret/);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(values.local), hash(loginToken), '跨管道分块的中文登录数据必须完整');
  assert.equal(values.session, 'fake-session');
  assert.equal(result.imported.cookies, 1);
  const metrics = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name = 'HostDeck.exe'" | Where-Object { $_.CommandLine -match ' --seed$| "--seed"$' } | ForEach-Object { Get-Process -Id $_.ProcessId | Select-Object Id,WorkingSet64,PrivateMemorySize64,CPU } | ConvertTo-Json -Compress`], { windowsHide: true });
  if (metrics.stdout.trim()) await writeFile(path.resolve('output/seed-metrics.json'), metrics.stdout.trim());
  console.log('PASS: 独立 Chrome 首个请求携带 HttpOnly Cookie，脚本启动前可读取 localStorage 和 sessionStorage');
  assert.deepEqual(await deadline(reloaded), { local: 'changed-after-login', session: 'fake-session' });
  console.log('PASS: 页面刷新保留环境内更新的登录数据，没有重复覆盖');
  await assert.rejects(launch(), /关闭.*环境|管道.*断开/);
  console.log('PASS: 环境正在运行时明确要求先关闭，未静默误报导入成功');
  await closeTestProfile(profile);
  const ordinary = await request({ type: 'launch', environment: env, url }, { LOCALAPPDATA: root });
  assert.equal(ordinary.profile, profile);
  assert.deepEqual(await deadline(openedAgain), { local: 'changed-after-login', session: null });
  console.log('PASS: 普通独立窗口复用旧格式资料目录和已保存的页面状态');
  await closeTestProfile(profile);
  const sync = await request({ type: 'sync', environment: env }, { LOCALAPPDATA: root });
  assert.equal(sync.profile, profile);
  const syncCheck = `
    $needle = '--user-data-dir=' + '${profile.replaceAll("'", "''")}'
    $until = (Get-Date).AddSeconds(5)
    do {
      $items = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine.Contains($needle) -and $_.CommandLine.Contains('chrome://settings/syncSetup') })
      if ($items.Count) { exit 0 }
      Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $until)
    throw '同步设置没有在同一个隔离配置中打开'
  `;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', syncCheck], { windowsHide: true });
  console.log('PASS: 同步入口使用同一个独立配置，实际打开 Chrome 自带的同步设置');
} finally {
  try { await closeTestProfile(profile); } finally { server.close(); }
}
