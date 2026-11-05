/**
 * commands.js —— 机器人指令解析与任务实现
 *
 * 指令可以来自:游戏内聊天(以 ! 开头,或直接以机器人名字开头)、本地控制台 stdin。
 * 中文/英文指令都支持,例如 !跟随 / !follow、!挖 钻石 / !mine diamond_ore
 */

// 方块中文别名(英文 id 也能直接用,支持模糊匹配)
const BLOCK_ALIASES = {
  煤: 'coal_ore', 煤矿: 'coal_ore', 煤炭: 'coal_ore',
  铁: 'iron_ore', 铁矿: 'iron_ore', 铁矿石: 'iron_ore',
  铜: 'copper_ore', 铜矿: 'copper_ore',
  金: 'gold_ore', 金矿: 'gold_ore',
  钻石: 'diamond_ore', 钻石矿: 'diamond_ore', 金刚石: 'diamond_ore',
  红石: 'redstone_ore', 青金石: 'lapis_ore', 绿宝石: 'emerald_ore',
  石英: 'nether_quartz_ore', 下界石英: 'nether_quartz_ore',
  远古残骸: 'ancient_debris', 下界合金: 'ancient_debris',
  深板岩: 'deepslate', 石头: 'stone', 圆石: 'cobblestone',
  泥土: 'dirt', 草方块: 'grass_block', 沙子: 'sand', 沙砾: 'gravel',
  原木: 'oak_log', 木头: 'oak_log', 橡木: 'oak_log',
  黑曜石: 'obsidian', 冰: 'ice', 雪: 'snow_block',
};

const AIR = new Set(['air', 'cave_air', 'void_air']);
const LIQUIDS = new Set(['water', 'lava', 'flowing_water', 'flowing_lava']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 背包满的时候优先丢掉的杂物(越靠前越先丢)
const JUNK_ORDER = [
  'cobblestone', 'cobbled_deepslate', 'deepslate', 'dirt', 'grass_block', 'gravel', 'flint',
  'andesite', 'diorite', 'granite', 'tuff', 'calcite', 'basalt', 'blackstone', 'netherrack',
  'sand', 'red_sand', 'sandstone', 'snowball', 'clay_ball',
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
];

// 「要留」的东西:工具/护甲/食物/建材/值钱的矿。不在这个名单里的一律算杂物,可以丢。
// 用白名单而不是黑名单,是因为 1.21 挖掘会带出一堆你事先想不到的东西(凝灰岩、苔藓、骨头、树苗……)。
const KEEP_PATTERNS = [
  /_pickaxe$/, /_sword$/, /_shovel$/, /_axe$/, /_hoe$/, /_helmet$/, /_chestplate$/, /_leggings$/, /_boots$/,
  /^torch$/, /_planks$/, /^shield$/, /^bucket$/, /^water_bucket$/, /^lava_bucket$/, /^flint_and_steel$/, /^shears$/,
  /^cooked_/, /^bread$/, /^apple$/, /^golden_apple$/, /^stick$/,
  /^diamond$/, /^emerald$/, /^lapis_lazuli$/, /^redstone$/, /^coal$/, /^charcoal$/,
  /^raw_iron$/, /^raw_copper$/, /^raw_gold$/, /^iron_ingot$/, /^gold_ingot$/, /^copper_ingot$/,
  /^quartz$/, /^amethyst_shard$/, /^ancient_debris$/, /^netherite_scrap$/, /^obsidian$/,
  /^ender_pearl$/, /^blaze_rod$/, /^experience_bottle$/,
];
const isKeep = (name) => KEEP_PATTERNS.some((re) => re.test(name));

// 会主动打人的生物(用于自动反击)
const HOSTILE = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'witch', 'slime', 'magma_cube', 'enderman', 'endermite',
  'silverfish', 'pillager', 'vindicator', 'ravager', 'phantom', 'blaze', 'ghast',
  'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'guardian', 'elder_guardian', 'warden',
  'breeze', 'shulker', 'evoker', 'illusioner', 'vex',
]);

function withTimeout(promise, ms, msg) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(msg)), ms); }),
  ]);
}

export function createCommander(bot, ctx, log = console.log) {
  const { goals } = ctx;

  // ---------- 任务状态 ----------
  let current = null; // { name, detail, token }
  const alive = (token) => token.alive && current?.token === token;

  function stopTask() {
    if (current) {
      current.token.alive = false;
      log(`[任务结束] ${current.name} ${current.detail}`);
      current = null;
    }
    try { bot.pathfinder.setGoal(null); } catch { /* 忽略 */ }
    try { bot.collectBlock.cancelTask?.(); } catch { /* 忽略 */ }
  }

  function beginTask(name, detail = '') {
    stopTask();
    const token = { alive: true };
    current = { name, detail, token };
    log(`[任务开始] ${name} ${detail}`);
    return token;
  }

  const setDetail = (d) => { if (current) current.detail = d; };

  // ---------- 通用工具 ----------
  const isAir = (b) => !b || AIR.has(b.name);
  const isLiquid = (b) => !!b && LIQUIDS.has(b.name);

  function registry() {
    return bot.registry.blocksByName;
  }

  /** 把用户输入解析成一组方块 id */
  function resolveBlockIds(token) {
    const raw = String(token || '').trim().toLowerCase().replace(/^minecraft:/, '');
    if (!raw) return { ids: [], names: [] };
    const byName = registry();
    const names = new Set();

    if (BLOCK_ALIASES[raw]) names.add(BLOCK_ALIASES[raw]);
    if (byName[raw]) names.add(raw);
    // 深板岩变体:钻石矿 -> deepslate_diamond_ore
    for (const n of [...names]) if (byName[`deepslate_${n}`]) names.add(`deepslate_${n}`);
    // 模糊匹配
    if (names.size === 0) {
      for (const n of Object.keys(byName)) if (n.includes(raw)) names.add(n);
    }
    const list = [...names].filter((n) => byName[n]);
    return { ids: list.map((n) => byName[n].id), names: list };
  }

  function preciousIds() {
    const byName = registry();
    return Object.keys(byName)
      .filter((n) => n.endsWith('_ore') || n === 'ancient_debris')
      .map((n) => byName[n].id);
  }

  /** 玩家名 -> entity(不填则用最近玩家) */
  function findPlayer(name) {
    const q = String(name || '').trim();
    if (q) {
      const p = bot.players[q];
      if (p?.entity) return p.entity;
      // 不区分大小写
      const key = Object.keys(bot.players).find((k) => k.toLowerCase() === q.toLowerCase());
      if (key && bot.players[key].entity) return bot.players[key].entity;
      return null;
    }
    let best = null, bestD = Infinity;
    for (const [n, p] of Object.entries(bot.players)) {
      if (n === bot.username || !p.entity) continue;
      const d = bot.entity.position.distanceTo(p.entity.position);
      if (d < bestD) { bestD = d; best = p.entity; }
    }
    return best;
  }

  async function gotoPos(pos, token, timeout = 20000) {
    if (!alive(token)) return false;
    try {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalBlock(pos.x, pos.y, pos.z)),
        timeout, '寻路超时',
      );
      return alive(token);
    } catch (e) {
      if (alive(token)) log(`[寻路失败] ${e.message}`);
      try { bot.pathfinder.setGoal(null); } catch { /* 忽略 */ }
      return false;
    }
  }

  /**
   * 走到目标「附近」。
   * 用 GoalNear 而不是 GoalBlock:玩家站的那一格往往进不去(头上有方块、就站在墙边),
   * 按精确坐标找路会直接判定无路可走 —— 之前 !来 失败、!跟随 成功就是这个原因。
   */
  async function gotoNear(pos, token, timeout = 60000, range = 2) {
    if (!alive(token)) return false;
    try {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range)),
        timeout, '寻路超时',
      );
      return alive(token);
    } catch (e) {
      if (alive(token)) log(`[寻路失败] ${e.message}`);
      try { bot.pathfinder.setGoal(null); } catch { /* 忽略 */ }
      return false;
    }
  }

  /** 挖掉一个方块,返回是否真的挖掉了(空气/水/挖不动 → false) */
  async function digAt(pos, token) {
    const b = bot.blockAt(pos);
    if (isAir(b)) return false;
    if (isLiquid(b)) {
      if (b.name.includes('lava')) throw new Error('前方是岩浆,已停止挖掘');
      return false;
    }
    if (!b.diggable) return false;
    try {
      // 拿最好的工具(有钻石镐就用钻石镐,否则空手挖石头要 7 秒)
      if (bot.tool?.equipForBlock) {
        try { await bot.tool.equipForBlock(b); } catch { /* 没合适工具就空手 */ }
      }
      await bot.dig(b, true);
      return true;
    } catch (e) {
      if (alive(token)) log(`[挖掘失败] ${b.name}: ${e.message}`);
      return false;
    }
  }

  /** 捡起附近的掉落物(只捡一小圈,别为了杂物到处乱跑,背包会爆) */
  async function pickupItems(token, radius = 4, rounds = 2) {
    for (let i = 0; i < rounds && alive(token); i++) {
      const item = Object.values(bot.entities)
        .filter((e) => (e.name === 'item' || e.displayName === 'Item') && e.position)
        .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
        .find((e) => bot.entity.position.distanceTo(e.position) < radius);
      if (!item) return;
      try {
        await withTimeout(
          bot.pathfinder.goto(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1)),
          6000, '捡东西超时',
        );
      } catch { /* 捡不到就算了 */ }
    }
  }

  const countItem = (name) =>
    bot.inventory.items().filter((i) => i.name === name).reduce((s, i) => s + i.count, 0);

  /**
   * 保证背包有空位。
   * 为什么必须做:mineflayer-collectblock 在背包 0 空位时会去找箱子存东西,
   * 而本地服务器没有定义箱子 → 直接抛 "There are no defined chest locations!",挖矿全废。
   */
  async function ensureSpace(minFree = 2) {
    if (bot.inventory.emptySlotCount() >= minFree) return true;
    for (let guard = 0; guard < 40; guard++) {
      if (bot.inventory.emptySlotCount() >= minFree) return true;
      const items = bot.inventory.items();
      // 先按偏好丢经典杂物,再退化成「丢掉任何不在保留名单里的东西」
      const junk = items.find((i) => JUNK_ORDER.includes(i.name))
                ?? items.find((i) => !isKeep(i.name));
      if (!junk) break;
      try {
        // 丢之前先回头,免得丢出去的东西正好落在前进路线上被自己又捡回来
        try { await bot.look(bot.entity.yaw + Math.PI, 0, true); } catch { /* 忽略 */ }
        await bot.toss(junk.type, null, junk.count);
        log(`[整理背包] 丢出 ${junk.name}×${junk.count}`);
        await sleep(150);
      } catch { break; }
    }
    return bot.inventory.emptySlotCount() >= minFree;
  }

  /** 把杂物全丢掉 */
  async function clearJunk() {
    let dropped = 0;
    for (let guard = 0; guard < 60; guard++) {
      const items = bot.inventory.items();
      const junk = items.find((i) => JUNK_ORDER.includes(i.name))
                ?? items.find((i) => !isKeep(i.name));
      if (!junk) break;
      try { await bot.toss(junk.type, null, junk.count); dropped++; await sleep(150); } catch { break; }
    }
    return dropped;
  }

  // ---------- 任务:跟随 / 过来 ----------
  function taskFollow(targetName) {
    const target = findPlayer(targetName);
    if (!target) return '没找到这个玩家(名字要对,而且他得在你附近已加载的区块里)';
    const token = beginTask('跟随', `跟随 ${target.username}`);
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);

    const watchdog = setInterval(() => {
      if (!alive(token)) return clearInterval(watchdog);
      const d = bot.entity.position.distanceTo(target.position);
      setDetail(`跟随 ${target.username},距离 ${d.toFixed(1)} 格`);
      if (d > 8 && !bot.pathfinder.isMoving()) {
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
      }
    }, 5000);

    return `好的,开始跟随 ${target.username}`;
  }

  async function taskCome(targetName) {
    const target = findPlayer(targetName);
    if (!target) return '没找到这个玩家';
    const token = beginTask('过来', `前往 ${target.username}`);
    bot.chat(`正在前往 ${target.username} 处`);
    const ok = await gotoNear(target.position, token, 60000, 2);
    if (ok && alive(token)) {
      setDetail(`已到达 ${target.username} 附近`);
      const r = `到了,${target.username}(距 ${bot.entity.position.distanceTo(target.position).toFixed(1)} 格)`;
      stopTask();
      return r;
    }
    if (alive(token)) { stopTask(); return '走不过去(可能被挡/太远)'; }
    return null;
  }

  // ---------- 任务:挖指定方块 ----------
  async function taskMine(token, ids, count) {
    let got = 0;
    let why = '';
    while (alive(token) && got < count) {
      // 留 4 格余量:寻路过程中会顺手捡起地上的东西,留太少会在 collectBlock 内部又变成「满」
      if (!(await ensureSpace(4))) { why = '背包满了,没有可丢的杂物'; break; }
      const block = bot.findBlock({ matching: ids, maxDistance: 64 });
      if (!block) { why = '附近没有了'; break; }
      setDetail(`已挖 ${got}/${count},目标 ${block.name} @ ${block.position}`);
      try {
        await withTimeout(
          bot.collectBlock.collect(block, { ignoreNoPath: true }),
          60000, '挖矿超时',
        );
        got++;
      } catch (e) {
        const msg = String(e.message || e);
        // 典型情况:寻路时把地面上的东西捡满了,collectBlock 于是想找箱子存东西
        if (/chest locations|NoChests/i.test(msg)) {
          if (await ensureSpace(4)) {
            try {
              await withTimeout(bot.collectBlock.collect(block, { ignoreNoPath: true }), 60000, '挖矿超时');
              got++;
              continue;
            } catch (e2) { why = `背包塞满(${e2.message})`; break; }
          }
          why = '背包满了,没有可丢的杂物';
          break;
        }
        if (alive(token)) log(`[挖矿异常] ${msg}`);
        why = `挖到第 ${got + 1} 个时出错(${msg})`;
        break;
      }
    }
    await pickupItems(token, 8);
    return `挖矿结束:挖到 ${got} 个${why ? `,${why}` : ''}`;
  }

  /** 找附近矿石并逐个采集 */
  async function mineNearbyOres(token, radius, limit = 6) {
    const ids = preciousIds();
    for (let i = 0; i < limit && alive(token); i++) {
      if (!(await ensureSpace(3))) return;
      const block = bot.findBlock({ matching: ids, maxDistance: radius });
      if (!block) return;
      try {
        await withTimeout(bot.collectBlock.collect(block, { ignoreNoPath: true }), 60000, '挖矿超时');
        log(`[顺手挖到] ${block.name}`);
      } catch { return; }
    }
  }

  /** 面朝方向吸附到 4 个主轴之一 */
  function forwardDir() {
    const yaw = bot.entity.yaw;
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    return Math.abs(dx) > Math.abs(dz)
      ? { x: Math.sign(dx), z: 0 }
      : { x: 0, z: Math.sign(dz) };
  }

  // ---------- 任务:挖矿道(分支挖矿) ----------
  async function taskStrip(token, length) {
    const dir = forwardDir();
    const axis = dir.x !== 0 ? '东西向' : '南北向';
    bot.chat(`开始挖矿道:${axis},前进方向 (${dir.x},${dir.z}),计划 ${length} 格`);
    let steps = 0;
    let broken = 0;
    try {
      for (let i = 0; i < length && alive(token); i++) {
        if (!(await ensureSpace(2))) { log('[矿道] 背包满且无可丢杂物,停止'); break; }
        const base = bot.entity.position.floored();
        // 清理前方 1x2 通道(先头后脚,避免卡住)
        for (const dy of [1, 0]) {
          if (await digAt(base.offset(dir.x, dy, dir.z), token)) broken++;
        }
        // 往前走一格
        const next = base.offset(dir.x, 0, dir.z);
        const ok = await gotoPos(next, token, 8000);
        if (!ok) log('[矿道] 走不过去,继续尝试下一格');
        await mineNearbyOres(token, 4, 2);
        await pickupItems(token, 6, 2);
        steps++;
        setDetail(`已前进 ${steps}/${length} 格,挖掉 ${broken} 个方块 (${axis})`);
      }
    } catch (e) {
      log(`[矿道中止] ${e.message}`);
      if (alive(token)) { stopTask(); return `挖矿道中止:${e.message} (前进 ${steps} 格,挖掉 ${broken} 个方块)`; }
      return null;
    }
    const msg = `挖矿道完成:前进 ${steps} 格,挖掉 ${broken} 个方块`;
    if (alive(token)) stopTask();
    return msg;
  }

  // ---------- 任务:挂机防踢 ----------
  function taskAfk() {
    const token = beginTask('挂机', '防踢出');
    (async () => {
      while (alive(token)) {
        try {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 250);
          await bot.look(bot.entity.yaw + (Math.random() - 0.5) * 1.2, 0, true);
        } catch { /* 忽略 */ }
        await sleep(25000);
      }
    })();
    return '进入挂机模式(每 25 秒动一下,不会被判定挂机踢出)';
  }

  // ---------- 装备 / 领取物资 ----------
  const KIT = [
    'diamond_pickaxe', 'diamond_sword', 'diamond_shovel', 'diamond_axe',
    'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
    'torch 64', 'cooked_beef 64', 'oak_planks 64',
  ];

  async function giveKit() {
    const lines = [];
    for (const entry of KIT) {
      const [name, n] = entry.split(' ');
      if (countItem(name) > 0) continue; // 已经有了就不重复发,免得占满背包
      bot.chat(`/give @s minecraft:${name}${n ? ` ${n}` : ''}`);
      await sleep(120);
    }
    await sleep(800);
    const missing = KIT.map((e) => e.split(' ')[0]).filter((n) => countItem(n) === 0);
    if (missing.length === 0) return '物资已发放(钻石工具 + 铁甲 + 火把 + 食物 + 木板)';
    return `发放结果:缺 ${missing.join(', ')}。说明机器人不是 OP —— 在服务端控制台执行 op ${bot.username} 后重试`;
  }

  async function equipArmor() {
    const plan = [
      [['netherite_helmet', 'diamond_helmet', 'iron_helmet', 'golden_helmet', 'chainmail_helmet', 'leather_helmet'], 'head'],
      [['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'golden_chestplate', 'chainmail_chestplate', 'leather_chestplate'], 'torso'],
      [['netherite_leggings', 'diamond_leggings', 'iron_leggings', 'golden_leggings', 'chainmail_leggings', 'leather_leggings'], 'legs'],
      [['netherite_boots', 'diamond_boots', 'iron_boots', 'golden_boots', 'chainmail_boots', 'leather_boots'], 'feet'],
    ];
    const done = [];
    for (const [names, dest] of plan) {
      const item = bot.inventory.items().find((i) => names.includes(i.name));
      if (!item) continue;
      try { await bot.equip(item, dest); done.push(item.name); } catch { /* 忽略 */ }
    }
    return done.length ? `已穿上:${done.join(', ')}` : '背包里没有可穿的装备';
  }

  // ---------- 状态 / 扫描 ----------
  function statusText() {
    const p = bot.entity.position;
    const t = current ? `${current.name}${current.detail ? `(${current.detail})` : ''}` : '空闲';
    const inv = bot.inventory.items();
    return `位置 ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)} | 血量 ${bot.health?.toFixed(1)} | 饥饿 ${bot.food} | 背包 ${inv.length} 种物品 | 任务:${t}`;
  }

  function scanText(radius = 32) {
    const ids = preciousIds();
    const byId = new Map(Object.values(registry()).map((b) => [b.id, b.name]));
    const found = new Map();
    for (const block of bot.findBlocks({ matching: ids, maxDistance: radius, count: 200 })) {
      const n = byId.get(bot.blockAt(block).type);
      found.set(n, (found.get(n) || 0) + 1);
    }
    if (found.size === 0) return `${radius} 格内没发现矿石`;
    const list = [...found.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`).join(', ');
    return `${radius} 格内矿石:${list}`;
  }

  function invText() {
    const inv = bot.inventory.items();
    if (!inv.length) return '背包是空的';
    return `背包:${inv.map((i) => `${i.name}×${i.count}`).join(', ')}`;
  }

  // ---------- 指令表 ----------
  const HELP = [
    '===== 机器人指令(中英文都行)=====',
    '!来 / !come [玩家]      —— 走到玩家身边',
    '!跟随 / !follow [玩家]   —— 持续跟着玩家',
    '!停 / !stop              —— 停止当前任务',
    '!挖 / !mine <方块> [数量] —— 挖最近的指定方块,例:!挖 钻石 5',
    '!矿道 / !strip [长度]    —— 朝当前朝向挖一条矿道,顺手挖矿',
    '!挂机 / !afk             —— 防踢挂机',
    '!状态 / !status          —— 位置/血量/任务',
    '!找矿 / !scan [半径]     —— 报告附近矿石',
    '!背包 / !inv             —— 查看背包',
    '!清背包 / !junk          —— 丢出圆石/泥土等杂物(腾背包格子)',
    '!装备 / !kit             —— 领取物资(需 OP)',
    '!穿甲 / !armor           —— 自动穿上背包里的护甲',
    '!去 / !goto <x> <y> <z>  —— 走到坐标',
    '!丢 / !drop <物品>       —— 丢出指定物品',
    '!说 / !say <文本>        —— 让机器人说话',
  ].join('\n');

  // 别名 -> 规范指令
  const ALIAS = {
    help: 'help', 帮助: 'help', 指令: 'help',
    come: 'come', 来: 'come', 过来: 'come',
    follow: 'follow', 跟随: 'follow', 跟: 'follow',
    stop: 'stop', 停: 'stop', 停止: 'stop', 别动: 'stop',
    mine: 'mine', 挖: 'mine', 挖矿: 'mine', 开采: 'mine',
    strip: 'strip', 矿道: 'strip', 挖矿道: 'strip', 分支挖矿: 'strip',
    afk: 'afk', 挂机: 'afk', 防踢: 'afk',
    status: 'status', 状态: 'status', 情况: 'status',
    scan: 'scan', 找矿: 'scan', 探矿: 'scan',
    inv: 'inv', 背包: 'inv', 物品: 'inv',
    junk: 'junk', 清背包: 'junk', 丢杂物: 'junk', 整理背包: 'junk',
    kit: 'kit', 装备: 'kit', 领物资: 'kit',
    armor: 'armor', 穿甲: 'armor', 穿装备: 'armor',
    goto: 'goto', 去: 'goto', 前往: 'goto',
    drop: 'drop', 丢: 'drop', 丢弃: 'drop',
    say: 'say', 说: 'say',
  };

  /**
   * 处理一条指令
   * @param {string} raw 原始文本(不含前缀)
   * @param {string} sender 发起者名字
   * @returns {Promise<string|void>} 要回复的文本(自动发到聊天栏)
   */
  async function handle(raw, sender = '控制台') {
    const text = String(raw || '').trim();
    if (!text) return;
    const [head, ...rest] = text.replace(/^[!/]/, '').split(/\s+/);
    const cmd = ALIAS[head.toLowerCase()];

    if (!cmd) return `不认识的指令:${head}(输入 !帮助 看列表)`;
    const arg0 = rest[0];

    switch (cmd) {
      case 'help': return HELP;
      case 'status': return statusText();
      case 'inv': return invText();
      case 'junk': {
        const n = await clearJunk();
        return n ? `丢出了 ${n} 堆杂物` : '背包里没有可丢的杂物';
      }
      case 'scan': return scanText(Number(arg0) || 32);
      case 'stop': {
        const had = current?.name;
        stopTask();
        return had ? `已停止:${had}` : '本来就没在做事';
      }
      case 'follow': return taskFollow(arg0);
      case 'come': return taskCome(arg0);
      case 'afk': return taskAfk();
      case 'kit': {
        const msg = await giveKit();
        const armor = await equipArmor(); // 领完顺手穿上,不然铁甲白躺在背包里
        return `${msg};${armor}`;
      }
      case 'armor': return await equipArmor();
      case 'say': return rest.join(' ');
      case 'goto': {
        const [x, y, z] = rest.map(Number);
        if ([x, y, z].some((v) => !Number.isFinite(v))) return '用法:!去 <x> <y> <z>';
        const token = beginTask('前往', `${x} ${y} ${z}`);
        const ok = await gotoNear({ x, y, z }, token, 120000, 2);
        if (alive(token)) stopTask();
        return ok ? '到了' : '走不过去';
      }
      case 'drop': {
        const { names } = resolveBlockIds(arg0);
        const item = bot.inventory.items().find((i) => i.name === arg0 || names.some((n) => i.name.includes(n)) || i.name.includes(String(arg0).toLowerCase()));
        if (!item) return `背包里没有 ${arg0}`;
        await bot.toss(item.type, null, item.count);
        return `丢出了 ${item.name}×${item.count}`;
      }
      case 'mine': {
        if (!arg0) return '用法:!挖 <方块名> [数量]  例:!挖 钻石 5';
        const { ids, names } = resolveBlockIds(arg0);
        if (!ids.length) return `找不到方块「${arg0}」`;
        const count = Math.max(1, Number(rest[1]) || 8);
        bot.chat(`去挖 ${names.join('/')} × ${count}`);
        const token = beginTask('挖矿', `${names.join('/')} ×${count}`);
        const r = await taskMine(token, ids, count);
        if (alive(token)) stopTask();
        return r;
      }
      case 'strip': {
        const length = Math.min(500, Math.max(1, Number(arg0) || 32));
        const token = beginTask('矿道', `${length} 格`);
        return await taskStrip(token, length);
      }
      default:
        return `指令 ${cmd} 还没实现`;
    }
  }

  /** 聊天栏单条有长度上限,过长的回复按逗号切开分多条发 */
  function chunkLine(line, max = 200) {
    if (line.length <= max) return [line];
    const out = [];
    let cur = '';
    for (const part of line.split(', ')) {
      if (cur && cur.length + part.length + 2 > max) { out.push(cur); cur = part; }
      else cur = cur ? `${cur}, ${part}` : part;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** 统一出口:执行指令并把结果发到聊天栏 */
  async function run(raw, sender) {
    try {
      const reply = await handle(raw, sender);
      if (reply) {
        for (const line of String(reply).split('\n')) {
          for (const piece of chunkLine(line)) {
            bot.chat(piece);
            await sleep(150);
          }
        }
      }
    } catch (e) {
      log(`[指令异常] ${e.stack || e.message}`);
      bot.chat(`指令出错:${e.message}`);
    }
  }

  // ---------- 自动反击(挖矿机器人在洞里被怪打死过,所以必须有) ----------
  let defending = false;
  let defenseTimer = null;

  function startDefense() {
    if (defenseTimer) return;
    defenseTimer = setInterval(async () => {
      if (defending || !bot.entity) return;
      const me = bot.entity.position;
      const mob = Object.values(bot.entities).find((e) =>
        e !== bot.entity && e.position && e.isValid !== false &&
        HOSTILE.has(e.name) && me.distanceTo(e.position) < 5);
      if (!mob) return;
      defending = true;
      log(`[防御] 发现 ${mob.name},反击`);
      try {
        const sword = bot.inventory.items().find((i) => i.name.endsWith('_sword'));
        if (sword) { try { await bot.equip(sword, 'hand'); } catch { /* 忽略 */ } }
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && bot.entity && mob.isValid !== false) {
          const d = bot.entity.position.distanceTo(mob.position);
          if (d > 6) break; // 跑远了不追
          // 近战攻击距离只有 3 格,够不着就先贴上去 —— 否则挥砍会被服务端判超距,白打
          if (d > 3.0) {
            try {
              await withTimeout(
                bot.pathfinder.goto(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, 1)),
                2500, '靠近超时');
            } catch { /* 贴不上就算了 */ }
            await sleep(150);
            continue;
          }
          try { await bot.lookAt(mob.position.offset(0, (mob.height || 1.8) * 0.8, 0), true); } catch { /* 忽略 */ }
          bot.attack(mob);
          await sleep(650); // 按武器攻速挥砍:砍太快伤害会被冷却衰减
        }
      } catch (e) {
        log(`[防御] 出错:${e.message}`);
      } finally {
        defending = false;
      }
    }, 700);
  }

  function dispose() {
    if (defenseTimer) { clearInterval(defenseTimer); defenseTimer = null; }
    stopTask();
  }

  return { run, handle, stopTask, startDefense, dispose, get current() { return current; } };
}
