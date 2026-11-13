import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHosts } from '../extension/core.mjs';

test('支持多行 hosts 和注释，并拒绝重复域名、IP 冒充参数及非法主机名', () => {
  assert.deepEqual(parseHosts('# 环境\n192.0.2.10 oa.example.test\n::1 api.example.test # IPv6'), [
    { host: 'oa.example.test', ip: '192.0.2.10' }, { host: 'api.example.test', ip: '::1' },
  ]);
  for (const text of ['127.0.0.1 --remote-debugging-port=9222', '1.2.3.4 a.test\n2.3.4.5 a.test',
    '127.0.0.999 a.test', '127.0.0.1 https://a.test', '127.0.0.1 *.test',
    '127.0.0.1 1.2.3.4', '127.0.0.1 0x7f000001']) {
    assert.throws(() => parseHosts(text));
  }
});
