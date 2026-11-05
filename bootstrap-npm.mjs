// 从 npm registry 直接引导一份 npm(本机没有 npm,只有 node + tar)
// 用法: node bootstrap-npm.mjs
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const tools = path.resolve('.tools');
const dest = path.join(tools, 'npm');
const tgz = path.join(tools, 'npm.tgz');

await mkdir(tools, { recursive: true });

console.log('查询 npm 最新版本 ...');
const meta = await (await fetch('https://registry.npmjs.org/npm/latest')).json();
console.log(`npm ${meta.version}`);

console.log('下载 tarball ...');
const bin = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
await writeFile(tgz, bin);
console.log(`${(bin.length / 1048576).toFixed(1)} MB`);

if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

console.log('解包 (tar.exe) ...');
execFileSync('C:\\Windows\\System32\\tar.exe', ['-xzf', tgz, '-C', dest], { stdio: 'inherit' });

const cli = path.join(dest, 'package', 'bin', 'npm-cli.js');
if (!existsSync(cli)) throw new Error(`解包后没找到 ${cli}`);
console.log(`\nnpm 引导完成:\n  ${cli}`);
