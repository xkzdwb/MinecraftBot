/**
 * fetch.mjs —— 通用下载器(项目里 Invoke-WebRequest 的 TLS 有问题,统一用 node 下)
 * 用法: node tools/fetch.mjs <url> <输出文件>
 */
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error('用法: node tools/fetch.mjs <url> <输出文件>');
  process.exit(1);
}

console.log(`下载 ${url}`);
const res = await fetch(url, { headers: { 'User-Agent': 'mcbot-setup/1.0' } });
if (!res.ok) {
  console.error(`失败: HTTP ${res.status} ${res.statusText}`);
  process.exit(2);
}
const buf = Buffer.from(await res.arrayBuffer());
await writeFile(out, buf);
console.log(`已保存 ${out}  ${(buf.length / 1048576).toFixed(2)} MB  sha256=${createHash('sha256').update(buf).digest('hex').slice(0, 16)}...`);
