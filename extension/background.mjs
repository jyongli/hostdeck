import { DEFAULT_ENVIRONMENTS, parseHosts, validateEnvironment } from './core.mjs';
import { NativeClient } from './native-client.mjs';

const native = new NativeClient();
// 同域名页面的登录存储属于整个 Chrome 配置，不能把 IP 分流当作登录隔离。
const TAB_MODE_DISABLED = '当前标签模式已停用：同域名标签共享登录数据，会相互退出登录。请分别使用「独立窗口」。';

// 只有用户主动点击「带入网站登录」时，短暂读取该网站；不持续拦截网页请求。
async function launchWithLogin(tabId, environment) {
  if (!chrome.debugger) throw new Error('Chrome 调试权限不可用，无法读取当前网站登录');
  const env = validateEnvironment(environment);
  const rules = parseHosts(env.hosts);
  const current = await chrome.tabs.get(tabId);
  let url;
  try { url = new URL(current.url); } catch { /* 统一返回明确的操作提示。 */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || !rules.some(({ host }) => host === url.hostname)) {
    throw new Error('请先在原 Chrome 中打开并登录此环境对应的网站，再点击「带入网站登录」');
  }
  await native.call('ping');
  const source = { tabId };
  await chrome.debugger.attach(source, '1.3');
  let snapshot;
  try {
    const urls = [url.href, ...rules.flatMap(({ host }) => [`http://${host}/`, `https://${host}/`])];
    const { cookies } = await chrome.debugger.sendCommand(source, 'Network.getCookies', { urls });
    const result = await chrome.debugger.sendCommand(source, 'Runtime.evaluate', { returnByValue: true, expression: `(() => ({
      origin: location.origin, local: Object.entries(localStorage), session: Object.entries(sessionStorage)
    }))()` });
    if (result.exceptionDetails || result.result?.value?.origin !== url.origin) {
      throw new Error('读取登录时页面已变化或禁止读取存储，请保持网站页面打开后重试');
    }
    snapshot = { cookies, storage: result.result.value };
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 8 * 1024 * 1024) {
      throw new Error('网站登录数据超过 8 MiB，请在独立窗口重新登录');
    }
  } finally {
    // 不安装 Fetch 拦截，不导航原网页；复制结束后立即解除临时调试。
    await chrome.debugger.detach(source).catch(() => {});
  }
  return native.call('launch', { environment: env, url: url.href, session: snapshot });
}

// 从旧停止页打开隔离窗口时，尽量保留原业务地址，而非丢掉原来的路径。
async function launchUrl(message) {
  if (/^https?:\/\//.test(message.url || '')) return message.url;
  if (!Number.isInteger(message.tabId)) return message.url;
  const key = `stopped-${message.tabId}`;
  return (await chrome.storage.session.get(key))[key]?.url || message.url;
}

async function dispatch(message) {
  switch (message.type) {
    case 'get': {
      const stored = await chrome.storage.local.get('environments');
      return { environments: stored.environments || DEFAULT_ENVIRONMENTS, active: null,
        tabModeAvailable: false, tabModeReason: TAB_MODE_DISABLED };
    }
    case 'save': {
      if (!Array.isArray(message.environments) || !message.environments.length || message.environments.length > 20) {
        throw new Error('需要 1–20 个环境');
      }
      const environments = message.environments.map(validateEnvironment);
      if (new Set(environments.map((env) => env.id)).size !== environments.length) throw new Error('环境标识不能重复');
      await chrome.storage.local.set({ environments });
      return { saved: true };
    }
    case 'ping': return native.call('ping');
    case 'launch': return native.call('launch', { environment: validateEnvironment(message.environment), url: await launchUrl(message) });
    case 'sync': return native.call('sync', { environment: validateEnvironment(message.environment) });
    case 'launchWithLogin': return launchWithLogin(message.tabId, message.environment);
    // 拒绝旧界面、旧消息及直接调用；必须在任何导航或登录数据变化之前返回。
    case 'start': throw new Error(TAB_MODE_DISABLED);
    case 'stop': return { stopped: false, message: '新版不再接管标签，请关闭旧业务标签后使用独立窗口。' };
    default: throw new Error('未知插件操作');
  }
}

// 不监听全局标签关闭；其余网页操作不会唤醒本扩展。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 页面脚本不能以通用消息接口驱动原生助手；仅接受本扩展自己的界面。
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  dispatch(message).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});
