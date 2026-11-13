import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { nativePlan } from '../extension/launch-plan.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension = path.resolve(process.env.HOSTDECK_EXTENSION || 'extension');
const output = path.resolve('output/playwright');
await mkdir(output, { recursive: true });
const servers = [];
const isolatedContexts = [];
let context, control, changedTab;
try {
  let port;
  for (const [ip, environment] of [['127.0.0.1', 'A'], ['127.0.0.2', 'B']]) {
    const server = http.createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.url === '/login') {
        res.setHeader('Set-Cookie', `login=${environment}; Path=/; SameSite=Lax`);
        res.end(JSON.stringify({ token: 'fake-' + environment })); return;
      }
      if (req.url === '/me') {
        const valid = req.headers.authorization === 'Bearer fake-' + environment
          && req.headers.cookie?.includes('login=' + environment);
        if (!valid) {
          res.statusCode = 401;
          res.setHeader('Set-Cookie', 'login=; Max-Age=0; Path=/');
        }
        res.end(JSON.stringify({ authenticated: valid })); return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<title>登录隔离回归 ${environment}</title><body data-login="waiting"><script>
        window.checkLogin = async () => {
          const response = await fetch('/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('login-token') } });
          if (!response.ok) localStorage.removeItem('login-token');
          document.body.dataset.login = response.ok ? 'logged-in' : 'logged-out';
        };
        window.loginFixture = async () => {
          const data = await (await fetch('/login')).json();
          localStorage.setItem('login-token', data.token); await checkLogin();
        };
        addEventListener('storage', () => {
          if (!localStorage.getItem('login-token')) document.body.dataset.login = 'logged-out';
        });
        checkLogin();
      </script></body>`);
    });
    await new Promise((resolve) => server.listen(port || 0, ip, resolve));
    port = server.address().port; servers.push(server);
  }
  context = await chromium.launchPersistentContext(path.join(output, 'auth-conflict-' + Date.now()), {
    executablePath: process.env.CHROMIUM_EXECUTABLE, headless: false,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server',
      '--host-resolver-rules=MAP auth-conflict.invalid 127.0.0.1'],
  });
  control = await context.newPage();
  await control.goto('chrome-extension://lfpancneciaghohokolpmdfmokmlkblp/popup.html');
  const pages = [await context.newPage(), await context.newPage()];
  const url = 'http://auth-conflict.invalid:' + port + '/';
  await Promise.all(pages.map((page, i) => page.goto(url + '#tab-' + i)));
  await Promise.all(pages.map((page) => page.waitForFunction(() => document.body.dataset.login === 'logged-out')));
  await pages[0].evaluate(() => loginFixture());
  await pages[1].evaluate(() => checkLogin());
  await Promise.all(pages.map((page) => page.waitForFunction(() => document.body.dataset.login === 'logged-in')));
  changedTab = await control.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url.endsWith('#tab-1')).id);
  const result = await control.evaluate((message) => chrome.runtime.sendMessage(message), {
    type: 'start', tabId: changedTab, url: url + '#tab-1',
    environment: { id: 'b', name: '回归环境 B', hosts: '127.0.0.2 auth-conflict.invalid' },
  });
  if (!result.error) await pages[1].waitForFunction(() => document.body.dataset.login === 'logged-out');
  const actual = await Promise.all(pages.map((page) => page.evaluate(() => ({
    loggedIn: document.body.dataset.login === 'logged-in',
    token: localStorage.getItem('login-token'), cookie: document.cookie,
  }))));
  // 观察真实登录状态，不用代理调用次数代替两个网页是否互相退出的证据。
  assert.deepEqual(actual.map((value) => value.loggedIn), [true, true], '旧标签切换入口不得让两个已登录网页同时退出');
  assert.ok(actual.every((value) => value.token === 'fake-A' && value.cookie.includes('login=A')));
  assert.match(result.error, /当前标签.*停用|独立窗口/);
  assert.equal(pages[1].url(), url + '#tab-1');
  assert.equal(await control.getByRole('button', { name: /当前标签|新标签/ }).count(), 0);
  const isolated = [];
  for (const [index, ip] of ['127.0.0.1', '127.0.0.2'].entries()) {
    const { rules } = nativePlan({ hosts: ip + ' auth-conflict.invalid' }, url);
    const hash = createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0,12);
    const profile = path.join(output, 'isolated-login-' + Date.now(), 'auth-' + index + '-' + hash);
    const instance = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.TEST_CHROME_EXECUTABLE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: false, args: ['--no-proxy-server', '--host-resolver-rules=MAP ' + rules[0].host + ' ' + rules[0].ip],
    });
    isolatedContexts.push(instance);
    const page = await instance.newPage();
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.login === 'logged-out');
    await page.evaluate(() => loginFixture());
    assert.equal(await page.evaluate(() => document.body.dataset.login), 'logged-in');
    assert.equal(await page.evaluate(() => localStorage.getItem('login-token')), 'fake-' + (index ? 'B' : 'A'));
    isolated.push(page);
  }
  // B 清掉自己的 Cookie 和 localStorage，再检查 A 与原 Chrome 中两个网页。
  await isolated[1].evaluate(async () => {
    document.cookie = 'login=; Max-Age=0; Path=/'; localStorage.removeItem('login-token'); await checkLogin();
  });
  await isolated[0].evaluate(() => checkLogin());
  assert.equal(await isolated[0].evaluate(() => document.body.dataset.login), 'logged-in');
  assert.equal(await isolated[1].evaluate(() => document.body.dataset.login), 'logged-out');
  await Promise.all(pages.map((page) => page.evaluate(() => checkLogin())));
  assert.deepEqual(await Promise.all(pages.map((page) => page.evaluate(() => document.body.dataset.login))), ['logged-in', 'logged-in']);
  const report = { time: new Date().toISOString(), result: 'pass',
    checks: ['旧 start 入口在导航前被拒绝', '原两个网页均保持登录', '原 Cookie 与 localStorage 未被修改',
      '弹窗不再提供标签切换按钮', '真实 Google Chrome 独立窗口分别使用 A/B 凭据登录', 'B 清理登录不影响 A 及原 Chrome'] };
  await writeFile(path.join(output, 'login-isolation-results.json'), JSON.stringify(report, null, 2));
  console.log('PASS: 旧标签切换入口安全拒绝，两个原网页均保持登录，Cookie 和 localStorage 未改动');
  console.log('PASS: 真实 Google Chrome 独立窗口分别登录 A/B；B 退出后 A 和原两个网页保持登录');
} finally {
  // 旧实现的失败复现也应先解除本测试标签接管，再关闭隔离浏览器。
  if (control && changedTab) await control.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'stop', tabId }), changedTab).catch(() => {});
  const cleanup = await Promise.allSettled([context?.close(), ...isolatedContexts.map((instance) => instance.close())]);
  for (const server of servers) server.close();
  for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
}
