/**
 * setup-ops.mjs —— 把玩家/机器人加进服务端 ops.json(离线模式)
 *
 * 离线模式的 UUID 是由玩家名算出来的:UUIDv3("OfflinePlayer:<名字>"),
 * 所以不用等对方进服就能直接给 OP 权限。
 *
 * 用法(在 server 目录下):
 *   node setup-ops.mjs XiaoMing 你的游戏名
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

function offlineUUID(name) {
  const h = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30; // version 3
  h[8] = (h[8] & 0x3f) | 0x80; // variant
  const hex = h.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const names = process.argv.slice(2);
if (names.length === 0) {
  console.log('用法: node setup-ops.mjs <玩家名> [更多名字...]');
  process.exit(1);
}

let ops = [];
try {
  ops = JSON.parse(await readFile('ops.json', 'utf8'));
  if (!Array.isArray(ops)) ops = [];
} catch { ops = []; }

for (const name of names) {
  const uuid = offlineUUID(name);
  const exist = ops.find((o) => o.name?.toLowerCase() === name.toLowerCase());
  if (exist) {
    exist.uuid = uuid;
    exist.level = 4;
    console.log(`更新 OP: ${name} (${uuid})`);
  } else {
    ops.push({ uuid, name, level: 4, bypassesPlayerLimit: false });
    console.log(`添加 OP: ${name} (${uuid})`);
  }
}

await writeFile('ops.json', JSON.stringify(ops, null, 2));
console.log(`已写入 ops.json,共 ${ops.length} 个管理员。服务端需重启或执行 /reload 生效。`);
