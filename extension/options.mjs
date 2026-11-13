import { parseHosts, validateEnvironment } from './core.mjs';
const $ = (selector) => document.querySelector(selector);
const call = async (message) => {
  const result = await chrome.runtime.sendMessage(message);
  if (result.error) throw new Error(result.error);
  return result;
};
let environments = (await call({ type: 'get' })).environments;
let selected = environments[0].id;
let unsaved = false;
let draftId = null;
function discardDraft() {
  if (draftId) { environments = environments.filter((environment) => environment.id !== draftId); draftId = null; }
}
function notify(text, error = false) { $('#message').textContent = text; $('#message').classList.toggle('error', error); }
function draw() {
  $('#list').replaceChildren();
  for (const environment of environments) {
    const button = document.createElement('button'); button.className = `env-tab${selected === environment.id ? ' selected' : ''}`;
    const dot = document.createElement('i'); dot.className = 'dot'; dot.style.background = environment.color;
    const name = document.createElement('span'); name.textContent = environment.name; button.append(dot, name);
    button.onclick = () => {
      if (selected === environment.id) return;
      if (unsaved && !confirm('当前修改尚未保存，放弃修改并切换环境？')) return;
      discardDraft();
      selected = environment.id; unsaved = false; draw();
    };
    $('#list').append(button);
  }
  const current = environments.find((environment) => environment.id === selected);
  $('#name').value = current.name; $('#color').value = current.color; $('#hosts').value = current.hosts;
  $('#delete').disabled = environments.length === 1; notify('');
}
$('#editor').oninput = () => { unsaved = true; };
$('#editor').onsubmit = async (event) => {
  event.preventDefault();
  try {
    parseHosts($('#hosts').value);
    const changed = validateEnvironment({ id: selected, name: $('#name').value, color: $('#color').value, hosts: $('#hosts').value });
    const next = environments.map((environment) => environment.id === selected ? changed : environment);
    await call({ type: 'save', environments: next });
    environments = next; unsaved = false; draftId = null; draw();
    notify('已保存。已打开的窗口和受控标签保持原规则；再次选择环境后使用新规则。');
  } catch (error) { notify(error.message, true); }
};
$('#add').onclick = () => {
  if (unsaved && !confirm('当前修改尚未保存，放弃修改并新建环境？')) return;
  discardDraft();
  if (environments.length >= 20) { notify('最多可保存 20 个环境', true); return; }
  const created = { id: crypto.randomUUID(), name: '新环境', color: '#7c3aed', hosts: '127.0.0.1 example.test' };
  environments.push(created); selected = created.id; draftId = created.id; draw(); unsaved = true; $('#name').focus();
};
$('#delete').onclick = async () => {
  if (environments.length <= 1 || !confirm('删除这个环境配置？已打开的窗口、标签和登录数据会保留。')) return;
  try {
    const next = environments.filter((environment) => environment.id !== selected);
    await call({ type: 'save', environments: next }); environments = next; selected = next[0].id; unsaved = false; draw();
  } catch (error) { notify(error.message, true); }
};
window.addEventListener('beforeunload', (event) => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } });
draw();
