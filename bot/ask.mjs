/**
 * ask.mjs —— 不用开游戏,直接给机器人下指令
 *
 * 用法:
 *   node ask.mjs "!状态"
 *   node ask.mjs "!找矿 32" "!背包"
 *   node ask.mjs --wait=30000 "!矿道 16"
 *
 * 它自己以一个临时玩家 Asker 进服,把指令发到聊天栏,再把机器人的回话打印出来。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');

const args = process.argv.slice(2);
const waitArg = args.find((a) => a.startsWith('--wait='));
const waitMs = Number(waitArg ? waitArg.slice(7) : 8000);
const cmds = args.filter((a) => !a.startsWith('--'));

if (cmds.length === 0) {
  console.log('用法: node ask.mjs [--wait=毫秒] "!指令" ["!指令2" ...]');
  process.exit(1);
}

const HOST = process.env.MC_HOST || '127.0.0.1';
const PORT = Number(process.env.MC_PORT || 25565);
const VERSION = process.env.MC_VERSION || '1.21.1';
const BOT = process.env.BOT_NAME || 'XiaoMing';

const bot = mineflayer.createBot({
  host: HOST, port: PORT, username: 'Asker', version: VERSION, auth: 'offline', hideErrors: true,
});

bot.on('chat', (username, message) => {
  if (username === BOT) console.log(`  <${BOT}> ${message}`);
});
bot.on('error', (e) => console.log('连接错误:', e.message));

bot.once('spawn', async () => {
  await new Promise((r) => setTimeout(r, 1500));
  for (const cmd of cmds) {
    console.log(`\n> ${cmd}`);
    bot.chat(cmd);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  bot.quit();
  process.exit(0);
});

setTimeout(() => { console.log('超时退出'); process.exit(1); }, 300000);
