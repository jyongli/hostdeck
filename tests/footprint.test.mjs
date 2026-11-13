import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { statSync } from 'node:fs';
import { exe, origin, request } from './native-request.mjs';

test('独立运行的单次助手低于 160 KiB，回复后主动退出', { timeout: 3000 }, async (t) => {
  const child = spawn(exe, [origin], { windowsHide: true });
  t.after(() => { child.stdin.destroy(); if (child.exitCode === null) child.kill(); });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  const body = Buffer.from(JSON.stringify({ type: 'ping', id: 'probe' }));
  const prefix = Buffer.alloc(4); prefix.writeUInt32LE(body.length);
  child.stdin.write(Buffer.concat([prefix, body]));
  await once(child.stdout, 'data');
  let forcedEof = false;
  const timer = setTimeout(() => { forcedEof = true; child.stdin.destroy(); }, 500);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(forcedEof, false, '回复后应自行退出，无需关闭输入管道');
    assert.equal(code, 0);
    const data = JSON.parse(Buffer.concat(chunks).subarray(4));
    assert.equal(data.result.engine, 'win32');
    assert.ok(statSync(exe).size < 160 * 1024);
  } finally { clearTimeout(timer); }
});

test('本机入口在启动前拒绝无关站点、非法规则和已停用的请求转发', async () => {
  const environment = { id: 'test', name: '测试', hosts: '127.0.0.1 example.invalid' };
  const base = { type: 'launch', environment, url: 'https://example.invalid/' };
  const storage = { origin: 'https://example.invalid', local: [], session: [] };
  await assert.rejects(request({ ...base, session: { cookies: [], storage: { ...storage, origin: 'https://other.invalid' } } }), /来源与目标网址/);
  const cookie = { name: 's', value: 'fake', domain: 'other.invalid', path: '/' };
  await assert.rejects(request({ ...base, session: { cookies: [cookie], storage } }), /环境以外/);
  await assert.rejects(request({ ...base, session: { cookies: [{ ...cookie, domain: 'example.invalid', partitionKey: {} }], storage } }), /分区 Cookie/);
  await assert.rejects(request({ ...base, plan: { url: base.url, rules: [{ host: 'example.invalid', ip: '127.0.0.1, MAP * 127.0.0.2' }] } }), /IP 无效/);
  await assert.rejects(request({ ...base, type: 'fetch' }), /未知助手命令/);
});
