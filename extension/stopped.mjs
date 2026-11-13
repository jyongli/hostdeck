const tabId = Number(location.hash.slice(1));
const stored = await chrome.storage.session.get(`stopped-${tabId}`);
const info = stored[`stopped-${tabId}`];
document.querySelector('#reason').textContent = info?.reason || '接管会话已经结束。';
document.querySelector('#settings').onclick = () => chrome.runtime.openOptionsPage();
document.querySelector('#normal').disabled = !info?.url;
document.querySelector('#normal').onclick = () => { if (info?.url) location.href = info.url; };
