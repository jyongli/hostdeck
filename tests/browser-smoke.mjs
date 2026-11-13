import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { closeTestProfile } from './native-request.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright');
await mkdir(output, { recursive: true });
const results = [], seededProfiles = [], reports = [];
const pass = (description) => { results.push(description); console.log('PASS:', description); };
const server = http.createServer(async (req, res) => {
  if (req.url === '/setcookie') {
    res.setHeader('Set-Cookie', 'session-login=fake-cookie; HttpOnly; Path=/'); res.end('ok'); return;
  }
  if (req.url === '/login-report') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    reports.push({ ...JSON.parse(Buffer.concat(chunks).toString('utf8')), cookie: req.headers.cookie || '' });
    res.end('ok'); return;
  }
  if (req.url === '/api') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cookie: req.headers.cookie || '' })); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<title>登录复制夹具</title><body>本地夹具<script>
    if (localStorage.getItem('copy-test') === 'fake-login') fetch('/login-report', {
      method:'POST', body:JSON.stringify({local:localStorage.getItem('copy-test'),session:sessionStorage.getItem('copy-session')})
    });
  </script></body>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  const extension = process.env.HOSTDECK_EXTENSION || path.join(root, 'extension');
  const { version } = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  context = await chromium.launchPersistentContext(path.join(output, 'extension-profile-' + Date.now()), {
    executablePath: process.env.CHROMIUM_EXECUTABLE, headless: false,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server',
      '--host-resolver-rules=MAP source-login.invalid 127.0.0.1'],
  });
  const control = await context.newPage();
  const prefix = 'chrome-extension://lfpancneciaghohokolpmdfmokmlkblp/';
  await control.goto(prefix + 'popup.html');
  const call = (message) => control.evaluate((value) => chrome.runtime.sendMessage(value), message);
  assert.deepEqual(await call({ type: 'ping' }), { version, engine: 'win32' });
  assert.equal((await call({ type: 'get' })).tabModeAvailable, false);
  await control.locator('.connection.ok').waitFor();
  assert.equal(await control.getByRole('button', { name: /当前标签|新标签/ }).count(), 0);
  assert.equal(await control.getByRole('button', { name: '独立窗口', exact: true }).count(), 2);
  assert.equal(await control.getByRole('button', { name: '带入网站登录', exact: true }).count(), 2);
  assert.equal(await control.getByRole('button', { name: '同步 Chrome 资料', exact: true }).count(), 2);
  assert.equal(await control.locator('#version').textContent(), version + ' · 本地运行');
  await control.locator('body').screenshot({ path: path.join(output, 'popup.png') });
  pass('发行扩展弹窗、一次性本机连接及三类窗口操作入口可用');

  const source = await context.newPage();
  const sourceUrl = 'http://source-login.invalid:' + server.address().port + '/';
  await source.goto(sourceUrl);
  await source.evaluate(async () => {
    await fetch('/setcookie'); localStorage.setItem('copy-test', 'fake-login'); sessionStorage.setItem('copy-session', 'fake-session');
  });
  await source.bringToFront();
  const sourceId = await control.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const environment = { id: 'copy-fixture-' + Date.now(), name: '登录复制回归', hosts: '127.0.0.1 source-login.invalid' };
  // 在请求前计算专属资料目录，失败路径也能正常关闭自己的验收窗口。
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update('[{"host":"source-login.invalid","ip":"127.0.0.1"}]').digest('hex').slice(0,12);
  seededProfiles.push(path.join(process.env.LOCALAPPDATA, 'HostDeck', 'profiles', environment.id + '-' + digest));
  const inherited = await call({ type: 'launchWithLogin', tabId: sourceId, environment });
  assert.equal(inherited.error, undefined, inherited.error);
  assert.equal(inherited.profile, seededProfiles.at(-1));
  const deadline = Date.now() + 10000;
  while (!reports.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(reports.length, '独立窗口应实际读取复制的登录数据');
  assert.equal(reports[0].local, 'fake-login'); assert.equal(reports[0].session, 'fake-session');
  assert.match(reports[0].cookie, /session-login=fake-cookie/);
  assert.equal(source.url(), sourceUrl);
  assert.equal(await source.evaluate(() => localStorage.getItem('copy-test')), 'fake-login');
  assert.match((await source.evaluate(async () => (await (await fetch('/api')).json()))).cookie, /session-login=fake-cookie/);
  assert.equal(await control.evaluate(async (tabId) => {
    try { await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' }); return false; }
    catch (error) { return /not attached/i.test(error.message); }
  }, sourceId), true);
  pass('真实入口复制 HttpOnly Cookie 和两类页面存储，源网页不导航、不清登录并解除临时调试');

  const rejected = await call({ type: 'launchWithLogin', tabId: sourceId,
    environment: { ...environment, hosts: '127.0.0.1 unrelated.invalid' } });
  assert.match(rejected.error, /对应的网站/);
  assert.equal(source.url(), sourceUrl);
  pass('拒绝从不属于所选环境的网页复制登录，不改动原网页');

  const options = await context.newPage();
  await options.goto(prefix + 'options.html');
  await options.locator('#name').fill('联调环境 A');
  await options.locator('#hosts').fill('127.0.0.1 a.test\n127.0.0.2 a.test');
  await options.getByRole('button', { name: '保存环境' }).click();
  await options.getByRole('status').filter({ hasText: '只能配置一次' }).waitFor();
  await options.locator('#hosts').fill('192.0.2.10 oa.example.test');
  await options.getByRole('button', { name: '保存环境' }).click();
  await options.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal((await call({ type: 'get' })).environments[0].name, '联调环境 A');
  await options.getByRole('button', { name: '＋ 新建环境' }).click();
  options.once('dialog', (dialog) => dialog.accept());
  await options.getByRole('button', { name: '联调环境 A', exact: true }).click();
  await options.getByRole('button', { name: '保存环境' }).click();
  assert.equal((await call({ type: 'get' })).environments.length, 2);
  await options.screenshot({ path: path.join(output, 'options.png'), fullPage: true });
  pass('设置保存、重复域名校验及放弃草稿仍可用');
} finally {
  const cleanup = await Promise.allSettled([...seededProfiles.map(closeTestProfile), context?.close()]);
  server.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ time: new Date().toISOString(), results }, null, 2));
  for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
}
