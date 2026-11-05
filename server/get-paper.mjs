// 下载 PaperMC 服务端 jar(自动选最新稳定构建 + SHA256 校验)
// 用法: node get-paper.mjs [MC版本]   默认 1.21.1
import { createHash } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';

const mcVersion = process.argv[2] || '1.21.1';
const api = `https://fill.papermc.io/v3/projects/paper/versions/${mcVersion}/builds`;
const headers = { 'User-Agent': 'mcbot-setup/1.0 (local use)' };

console.log(`查询 Paper ${mcVersion} 构建列表 ...`);
const res = await fetch(api, { headers });
if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
const builds = await res.json();

const stable = builds.filter((b) => b.channel === 'STABLE');
const build = (stable.length ? stable : builds)[0];
const dl = build.downloads['server:default'];
console.log(`选定 build ${build.id} (${build.channel}), 文件 ${dl.name}, ${(dl.size / 1048576).toFixed(1)} MB`);

console.log('下载中 ...');
const file = await fetch(dl.url, { headers });
if (!file.ok) throw new Error(`下载失败 ${file.status}`);
const buf = Buffer.from(await file.arrayBuffer());

const sha = createHash('sha256').update(buf).digest('hex');
if (sha !== dl.checksums.sha256) throw new Error(`SHA256 校验失败\n期望 ${dl.checksums.sha256}\n实际 ${sha}`);
console.log('SHA256 校验通过');

await writeFile('server.jar.tmp', buf);
await rename('server.jar.tmp', 'server.jar');
console.log(`已保存 => ${process.cwd()}\\server.jar`);
