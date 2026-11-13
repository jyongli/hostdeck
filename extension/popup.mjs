import { parseHosts } from './core.mjs';
const $ = (selector) => document.querySelector(selector);
$('#version').textContent = `${chrome.runtime.getManifest().version} · 本地运行`;
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
$('#domain').textContent = /^https?:/.test(tab?.url || '') ? new URL(tab.url).host : '选择环境后将打开对应域名';
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
const call = async (message) => {
  const result = await chrome.runtime.sendMessage(message);
  if (result.error) throw new Error(result.error);
  return result;
};
function message(text, error = false) { $('#message').textContent = text; $('#message').classList.toggle('error', error); }
const config = await call({ type: 'get', tabId: tab?.id });
for (const environment of config.environments) {
  const rules = parseHosts(environment.hosts);
  const card = document.createElement('article'); card.className = 'card'; card.style.setProperty('--env', environment.color);
  const heading = document.createElement('div'); heading.className = 'env-heading';
  const dot = document.createElement('i'); dot.className = 'dot';
  const name = document.createElement('strong'); name.textContent = environment.name; heading.append(dot, name);
  const mappings = document.createElement('div'); mappings.className = 'rules';
  for (const rule of rules) { const line = document.createElement('div'); line.textContent = `${rule.host} → ${rule.ip}`; mappings.append(line); }
  const actions = document.createElement('div'); actions.className = 'actions';
  for (const [type, label] of [['launch', '独立窗口'], ['launchWithLogin', '带入网站登录'], ['sync', '同步 Chrome 资料']]) {
    const button = document.createElement('button'); button.textContent = label;
    button.className = type === 'launch' ? 'primary' : '';
    button.onclick = async () => {
      document.querySelectorAll('#environments button').forEach((item) => { item.disabled = true; });
      message('正在准备环境…');
      try {
        const result = await call({ type, environment, tabId: tab?.id, url: tab?.url });
        message(result.message || `已打开 ${environment.name} 独立环境。`);
      } catch (error) { message(error.message, true); }
      finally { document.querySelectorAll('#environments button').forEach((item) => { item.disabled = false; }); }
    };
    actions.append(button);
  }
  card.append(heading, mappings, actions); $('#environments').append(card);
}
try {
  await call({ type: 'ping' });
  $('#connection').classList.add('ok'); $('#connection span').textContent = '本机助手已连接';
} catch { $('#connection span').textContent = '本机助手未连接'; message('请先运行发行包中的「安装.cmd」，然后重新打开插件。', true); }
