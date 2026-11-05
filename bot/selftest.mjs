/**
 * selftest.mjs —— 端到端自测
 *
 * 再开一个假人当「玩家」,在游戏里发指令,检查机器人是否正确响应。
 * 前提:服务端已启动,且 bot.js 已经在跑。
 *
 * 用法: node selftest.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');

const HOST = process.env.MC_HOST || '127.0.0.1';
const PORT = Number(process.env.MC_PORT || 25565);
const VERSION = process.env.MC_VERSION || '1.21.1';
const BOT = process.env.BOT_NAME || 'XiaoMing';
const TESTER = 'TestPlayer';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${info ? ` — ${info}` : ''}`);
};

console.log(`自测:被测机器人 ${BOT},测试玩家 ${TESTER},服务器 ${HOST}:${PORT} (${VERSION})\n`);

const bot = mineflayer.createBot({ host: HOST, port: PORT, username: TESTER, version: VERSION, auth: 'offline', hideErrors: true });

const replies = [];
bot.on('chat', (username, message) => { if (username === BOT) replies.push(message); });
bot.on('error', (e) => console.log('测试端错误:', e.message));
bot.on('kicked', (r) => console.log('测试端被踢:', r));
// 命令执行失败时服务端会发系统消息,打出来方便定位(比如 /fill 坐标越界)
bot.on('messagestr', (m) => {
  if (/fill|not loaded|Unknown|denied|outside|No block|permission|权限|未知|越界/i.test(m)) {
    console.log('  [系统消息]', m);
  }
});

const dist = () => {
  const e = bot.players[BOT]?.entity;
  return e ? bot.entity.position.distanceTo(e.position) : Infinity;
};

/** 发一条指令,等机器人回复中出现匹配的内容 */
async function ask(cmd, match, timeout = 15000) {
  replies.length = 0;
  bot.chat(cmd);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const hit = replies.find((m) => match.test(m));
    if (hit) return hit;
    await sleep(150);
  }
  return null;
}

/** 发一条指令,收集接下来一段时间里机器人的所有回复(长回复会被分片,所以要看全部) */
async function askAll(cmd, waitMs = 3000) {
  replies.length = 0;
  bot.chat(cmd);
  await sleep(waitMs);
  return replies.join(' | ');
}

/** 等机器人上线(entity 可见) */
async function waitBotOnline(timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (bot.players[BOT]?.entity) return true;
    await sleep(500);
  }
  return false;
}

try {
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve);
    bot.once('error', reject);
    setTimeout(() => reject(new Error('测试端进服超时')), 30000);
  });
  console.log('测试玩家已进服\n');

  record('被测机器人在线', await waitBotOnline(), BOT);

  // 1. 状态
  let r = await ask('!状态', /位置/);
  record('!状态 返回位置/血量/任务', !!r, r || '超时无回复');

  // 2. 帮助
  r = await ask('!帮助', /机器人指令/);
  record('!帮助 返回指令列表', !!r);

  // 3. 领物资(验证 OP)。先清空背包,避免上一轮死亡掉落捡回来的杂物干扰后面挖矿测试。
  bot.chat('/clear XiaoMing');
  await sleep(1200);
  r = await ask('!装备', /物资已发放|发放结果|不是 OP/, 20000);
  const opOk = !!r && r.includes('物资已发放');
  record('!装备 领取物资(需要 OP)', opOk, r || '超时无回复');

  // 4. 过来(寻路)
  r = await ask('!来', /到了|走不过去|没找到这个玩家/, 70000);
  record('!来 走到玩家身边', !!r && r.includes('到了'), r || '超时无回复');

  // 5. 跟随:先让测试玩家走开,再看机器人有没有跟上
  r = await ask('!跟随', /开始跟随|没找到/, 15000);
  record('!跟随 接受指令', !!r && r.includes('开始跟随'), r || '超时无回复');
  if (r && r.includes('开始跟随')) {
    bot.setControlState('forward', true);
    await sleep(3000);
    bot.setControlState('forward', false);
    await sleep(4000);
    const d = dist();
    record('!跟随 机器人实际跟上了', d <= 8, `距离 ${d === Infinity ? '∞' : d.toFixed(1)} 格`);
  }

  // 6. 停止
  r = await ask('!停', /已停止|本来就没在做事/);
  record('!停 停止任务', !!r, r || '超时无回复');

  // 7. 自动反击:在机器人旁边召唤一只僵尸,看它会不会拔剑打死。
  //    这一步要放在「石头包围」测试之前,不然僵尸会卡在石头里,测不准。
  //    判定只盯「刚召唤的那只」的实体 id —— 夜空洞穴里会自然刷僵尸,按总数判定必然误报。
  const bp2 = bot.players[BOT].entity.position.floored();
  const spawnAt = { x: bp2.x + 1, y: bp2.y, z: bp2.z };
  const d2 = (e, p) => (e.position.x - p.x) ** 2 + (e.position.y - p.y) ** 2 + (e.position.z - p.z) ** 2;
  bot.chat(`/summon minecraft:zombie ${spawnAt.x} ${spawnAt.y} ${spawnAt.z} {PersistenceRequired:1b}`);
  await sleep(1500);
  const target = Object.values(bot.entities)
    .filter((e) => e.name === 'zombie')
    .sort((a, b) => d2(a, spawnAt) - d2(b, spawnAt))[0];
  const zid = target?.id;
  let zombieGone = false;
  for (let i = 0; i < 25 && zid != null; i++) {
    await sleep(1000);
    if (!bot.entities[zid]) { zombieGone = true; break; }
  }
  record('自动反击 打死靠近的僵尸', zid != null && zombieGone,
    zid == null ? '僵尸没召唤出来' : (zombieGone ? '召唤的那只已被清掉' : '召唤的那只还活着'));

  // 8. 挖方块:用最丰富的「石头」,并要求回复里的实际挖到数量 > 0
  r = await ask('!挖 石头 3', /挖矿结束|找不到方块/, 120000);
  const dugN = Number((r && /挖到 (\d+) 个/.exec(r)?.[1]) || 0);
  record('!挖 石头 3 真的挖到方块', !!r && dugN > 0, r || '超时无回复');

  // 9. 挖矿道:先用石头把机器人整个「包」起来,再看它能不能挖出去。
  //    只堵一个方向要靠朝向推算,容易测歪;四面都堵上,朝哪边都得挖。
  const bp = bot.players[BOT].entity.position.floored();
  bot.chat(`/fill ${bp.x - 3} ${bp.y} ${bp.z - 3} ${bp.x + 3} ${bp.y + 2} ${bp.z + 3} minecraft:stone`);
  await sleep(1200);
  bot.chat(`/fill ${bp.x} ${bp.y} ${bp.z} ${bp.x} ${bp.y + 1} ${bp.z} minecraft:air`); // 别把自己埋了
  await sleep(1200);

  r = await ask('!矿道 3', /挖矿道完成|挖矿道中止/, 180000);
  const brokenN = Number((r && /挖掉 (\d+) 个方块/.exec(r)?.[1]) || 0);
  const invAfter = await askAll('!背包');
  record('!矿道 3 真的挖穿了石头包围', !!r && r.includes('挖矿道完成') && brokenN >= 4,
    `${r || '超时无回复'};背包里有圆石:${/cobblestone/.test(invAfter) ? '是' : '否'}`);

  // 9. 找矿
  r = await ask('!找矿 16', /格内/);
  record('!找矿 扫描矿石', !!r, r || '超时无回复');

  // 10. 背包
  r = await ask('!背包', /背包/);
  record('!背包 列出物品', !!r, r || '超时无回复');

  // 11. 挂机 + 停
  r = await ask('!挂机', /挂机模式/);
  record('!挂机 进入挂机模式', !!r, r || '超时无回复');
  await ask('!停', /已停止|本来就没在做事/, 8000);
} catch (e) {
  record('自测流程', false, e.message);
} finally {
  const pass = results.filter((x) => x.ok).length;
  console.log(`\n===== 自测结果:${pass}/${results.length} 通过 =====`);
  for (const x of results) if (!x.ok) console.log(`  失败:${x.name}`);
  try { bot.quit(); } catch { /* 忽略 */ }
  await sleep(500);
  process.exit(pass === results.length ? 0 : 1);
}
