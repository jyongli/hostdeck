import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extension = path.resolve('extension');
const output = path.resolve('output/playwright');
await mkdir(output, { recursive: true });
const measurements = [];
for (const quiet of [false, true]) {
  const context = await chromium.launchPersistentContext(path.join(output, `infobar-${quiet}-${Date.now()}`), {
    executablePath: process.env.CHROMIUM_EXECUTABLE, headless: false, viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
      ...(quiet ? ['--silent-debugger-extension-api'] : [])],
  });
  try {
    const control = await context.newPage();
    await control.goto('chrome-extension://lfpancneciaghohokolpmdfmokmlkblp/popup.html');
    const target = await context.newPage();
    await target.goto('about:blank');
    await target.bringToFront();
    const before = await target.evaluate(() => ({ inner: innerHeight, outer: outerHeight }));
    const tabId = await control.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    await control.evaluate((tabId) => chrome.debugger.attach({ tabId }, '1.3'), tabId);
    if (!quiet) await target.waitForFunction((height) => innerHeight < height, before.inner);
    // 等待原生浏览器布局稳定，再比较页面可用高度；页面截图不能包含 Chrome 自身提示条。
    await target.waitForTimeout(600);
    const after = await target.evaluate(() => ({ inner: innerHeight, outer: outerHeight }));
    measurements.push({ quiet, before, after, reduced: before.inner - after.inner });
    if (quiet) assert.equal(after.inner, before.inner, '隐藏启动参数应避免调试提示占用页面高度');
    else assert.ok(after.inner < before.inner, '对照启动应实际显示占用高度的提示条');
    await control.evaluate((tabId) => chrome.debugger.detach({ tabId }), tabId);
    await control.evaluate((tabId) => chrome.tabs.remove(tabId), tabId);
  } finally { await context.close(); }
}
await writeFile(path.join(output, 'infobar-results.json'), JSON.stringify(measurements, null, 2));
console.log('PASS: 普通启动显示调试提示；隐藏参数启动后附加调试器不占用提示条高度', JSON.stringify(measurements));
