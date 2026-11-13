import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { minify } from 'terser';

const target = path.join(process.argv[2], 'extension');
await mkdir(path.join(target, 'icons'), { recursive: true });
// 只压缩发行副本，便于源码调试；ES 模块导出名仍由 Terser 保留。
for (const entry of await readdir('extension', { withFileTypes: true })) {
  const source = path.join('extension', entry.name);
  const output = path.join(target, entry.name);
  if (entry.name === 'icons') {
    for (const icon of await readdir(source)) await copyFile(path.join(source, icon), path.join(output, icon));
    continue;
  }
  if (!entry.isFile()) continue;
  let content = await readFile(source, 'utf8');
  if (entry.name.endsWith('.mjs')) content = (await minify(content, { module: true, compress: { passes: 3 }, mangle: true })).code;
  else if (entry.name.endsWith('.html')) content = content.trim().replace(/>\s+</g, '><');
  else if (entry.name.endsWith('.css')) content = content.trim().replace(/\r?\n/g, '');
  else if (entry.name.endsWith('.json')) content = JSON.stringify(JSON.parse(content));
  await writeFile(output, content);
}
