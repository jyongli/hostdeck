import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nativePlan } from '../extension/launch-plan.mjs';

export const exe = process.env.HOSTDECK_EXE || fileURLToPath(new URL('../output/HostDeck.exe', import.meta.url));
export const origin = 'chrome-extension://lfpancneciaghohokolpmdfmokmlkblp/';

export async function request(message, env = {}) {
  const child = spawn(exe, [origin], { windowsHide: true, env: { ...process.env, ...env } });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stdin.on('error', () => {});
  const plan = message.environment && nativePlan(message.environment, message.url);
  const body = Buffer.from(JSON.stringify({ id: 'test', plan, ...message }));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  child.stdin.write(Buffer.concat([header, body]));
  const timer = setTimeout(() => child.kill(), 42000).unref();
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0, '本机助手须处理一条消息后主动退出');
    const frame = Buffer.concat(chunks);
    assert.equal(frame.readUInt32LE(0), frame.length - 4);
    const reply = JSON.parse(frame.subarray(4));
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  } finally { clearTimeout(timer); child.stdin.destroy(); }
}

// 只匹配本次生成的完整配置参数；正常关闭专属验收窗口，禁止终止用户进程。
export async function closeTestProfile(profile) {
  const quoted = profile.replaceAll("'", "''");
  const script = `
    $profile = '${quoted}'
    $needle = '--user-data-dir=' + $profile
    function Find-TestBrowser {
      Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' -and
          ($_.CommandLine.Contains('"' + $needle + '"') -or $_.CommandLine.EndsWith($needle) -or $_.CommandLine.Contains($needle + ' ')) }
    }
    $until = (Get-Date).AddSeconds(8)
    do {
      $items = @(Find-TestBrowser)
      if (!$items.Count) { exit 0 }
      foreach ($item in $items) {
        $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
        if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }
      }
      Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $until)
    throw '验收窗口未能正常关闭，请关闭该临时配置的 Chrome 窗口'
  `;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
}
