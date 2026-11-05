/**
 * bot.js —— 假人机器人主程序
 *
 * 用法:
 *   node bot.js                                  连本机 127.0.0.1:25565,名字 XiaoMing
 *   node bot.js --name=Steve --task=follow       指定名字并自动跟随最近玩家
 *   node bot.js --host=1.2.3.4 --port=25565 --version=1.21.1
 *
 * 参数:
 *   --host=      服务器地址,默认 127.0.0.1
 *   --port=      端口,默认 25565
 *   --name=      机器人游戏名,默认 XiaoMing(离线模式随便起)
 *   --version=   MC 版本,默认 1.21.1
 *   --task=      进服后自动执行:idle|follow|afk|mine:<方块>|strip
 *   --autokit=   true 则进服自动领物资(需要机器人是 OP)
 *   --reconnect= false 则断开后不重连
 *   --defend=    false 则关掉自动反击(默认开启:附近 4.5 格有敌对生物就拔剑打)
 */
import { createRequire } from 'node:module';
import readline from 'node:readline';
import { createCommander } from './commands.js';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { plugin: collectBlockPlugin } = require('mineflayer-collectblock');
const mcDataLoader = require('minecraft-data');
const { loader: autoEatLoader } = await import('mineflayer-auto-eat'); // v5 只支持 ESM

// ---------------- 参数 ----------------
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const CFG = {
  host: arg('host', '127.0.0.1'),
  port: Number(arg('port', 25565)),
  name: arg('name', 'XiaoMing'),
  version: arg('version', '1.21.1'),
  task: arg('task', 'idle'),
  autokit: arg('autokit', 'false') === 'true',
  reconnect: arg('reconnect', 'true') !== 'false',
  defend: arg('defend', 'true') !== 'false', // 自动反击靠近的敌对生物
};

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (...a) => console.log(`[${stamp()}]`, ...a);

log(`启动配置: ${CFG.name} -> ${CFG.host}:${CFG.port} (MC ${CFG.version})`);

// ---------------- 连接 ----------------
let commander = null;
let reconnectDelay = 5000;
let quitting = false;

function start() {
  const bot = mineflayer.createBot({
    host: CFG.host,
    port: CFG.port,
    username: CFG.name,
    version: CFG.version,
    auth: 'offline', // 离线模式服务器:不需要正版账号
    // 1.21.1 的配方包偶发「半包解析失败」,protodef 会打印一大坨堆栈后丢弃该包(不影响功能)。
    // hideErrors 打开 = 让 protodef/mineflayer 别打印,真正的错误由下面自己的 error 处理器负责。
    hideErrors: true,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlockPlugin);

  bot.once('login', () => log('已登录,等待进入世界 ...'));

  bot.once('spawn', async () => {
    reconnectDelay = 5000;
    const pos = bot.entity.position;
    log(`已进入世界 @ ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`);

    // 寻路参数
    const mcData = mcDataLoader(bot.version);
    const movements = new Movements(bot, mcData);
    movements.canDig = true;
    movements.allow1by1towers = true;
    movements.canOpenDoors = true;
    movements.scafoldingBlocks = [];
    bot.pathfinder.setMovements(movements);

    // 自动进食
    try {
      bot.loadPlugin(autoEatLoader);
      bot.autoEat.setOpts({ minHunger: 16, bannedFood: ['rotten_flesh', 'pufferfish', 'poisonous_potato', 'spider_eye', 'chorus_fruit'] });
      bot.autoEat.enableAuto();
      log('自动进食已开启');
    } catch (e) {
      log('自动进食开启失败(不影响其它功能):', e.message);
    }

    commander = createCommander(bot, { goals }, log);
    if (CFG.defend) commander.startDefense();

    if (CFG.autokit) {
      await new Promise((r) => setTimeout(r, 1500));
      log(await commander.handle('!装备', '自动'));
    }

    // --task 自动任务
    if (CFG.task && CFG.task !== 'idle') {
      await new Promise((r) => setTimeout(r, 800));
      if (CFG.task.startsWith('mine:')) await commander.run(`!挖 ${CFG.task.slice(5)} 8`, '自动任务');
      else if (CFG.task === 'strip') await commander.run('!矿道 64', '自动任务');
      else await commander.run(`!${CFG.task === 'follow' ? '跟随' : CFG.task}`, '自动任务');
    }

    bot.chat('机器人已上线,输入 !帮助 查看指令');
  });

  // 死亡自动复活
  bot.on('death', () => {
    log('机器人死了,准备复活 ...');
    try { bot.respawn(); } catch { /* 忽略 */ }
  });

  // 聊天指令:!开头,或直接喊机器人名字
  const onChat = (username, message) => {
    if (!commander || username === bot.username) return;
    const text = message.trim();
    const called = text.startsWith('!') || text.toLowerCase().startsWith(bot.username.toLowerCase());
    if (!called) return;
    const body = text.startsWith('!') ? text : text.slice(bot.username.length);
    log(`<${username}> ${text}`);
    commander.run(body, username);
  };
  bot.on('chat', onChat);
  bot.on('whisper', (username, message) => {
    if (!commander || username === bot.username) return;
    log(`[私聊] <${username}> ${message}`);
    commander.run(message, username);
  });

  // 断线 / 被踢
  bot.on('kicked', (reason) => log('被踢出:', typeof reason === 'string' ? reason : JSON.stringify(reason)));
  bot.on('error', (e) => {
    if (e.name === 'PartialReadError') return; // 已由 hideErrors 静默,这里再兜一层
    log('连接错误:', e.message);
  });
  bot.on('end', (reason) => {
    log('连接结束:', reason);
    try { commander?.dispose(); } catch { /* 忽略 */ }
    commander = null;
    if (!CFG.reconnect || quitting) return;
    log(`${reconnectDelay / 1000} 秒后重连 ...`);
    setTimeout(start, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60000);
  });

  // 本地控制台:直接敲指令(不带 ! 也行)
  if (!globalThis.__stdinHooked) {
    globalThis.__stdinHooked = true;
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const t = line.trim();
      if (!t) return;
      if (t === 'exit' || t === 'quit') { quitting = true; process.exit(0); }
      if (commander) commander.run(t, '控制台');
      else log('机器人还没进服');
    });
  }

  return bot;
}

start();

process.on('SIGINT', () => { quitting = true; log('收到 Ctrl+C,退出'); process.exit(0); });
