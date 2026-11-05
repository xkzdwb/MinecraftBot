# 本地 Minecraft 假人机器人(mcbot)

本机自己开一个 Minecraft **1.21.1** 服务端(Paper,离线模式),再用 Node + [mineflayer](https://github.com/PrismarineJS/mineflayer) 驱动一个「假人」玩家连进去。
你用自己的客户端(PCL2 里的 1.21.1)进同一个世界,就能和机器人一起玩:让它跟着你、替你挖矿、或者挂机占位。

> 机器人的「感知」全部来自游戏数据包(坐标、血量、背包、方块),**没有画面**。
> 所以「跟随 / 挖方块 / 捡东西 / 走到坐标 / 打靠近的怪」这类事很可靠,但它不会「看」,做不了复杂 PvP。

---

## 一、快速开始

### 0. 如果这是从备份恢复的一份

这份备份**只含源码/脚本/配置**,没有 Node 运行时、依赖和 Paper 服务端。先跑一次:

```powershell
.\setup.ps1
```

它会:下载官方 Node 到 `.tools\node`(自带 npm)→ 按 `package-lock.json` 装依赖 → 下载 Paper 服务端 jar。
需要联网,还有 **Java 21**(脚本会检查并提示)。

### 方式 A:一键启动(推荐)

在 `mcbot` 目录里右键 `start-all.ps1` → 使用 PowerShell 运行。

它会:① 新窗口开服务端 → ② 等 25565 端口通 → ③ 当前窗口启动机器人。
首次启动要生成世界,**大约 1~2 分钟**。看到 `已进入世界 @ x y z` 就成功了。

### 方式 B:分两步

```powershell
.\start-server.ps1          # 窗口 1:服务端(这个窗口就是服务器控制台)
.\start-bot.ps1             # 窗口 2:机器人
.\start-bot.ps1 -Task follow -AutoKit   # 进服自动跟随 + 自动领物资 + 自动穿甲
```

### 然后你自己进游戏

用 PCL2 启动 **1.21.1** → 多人游戏 → 直接连接 → 地址填 `127.0.0.1`(或 `localhost`)。
离线模式,**用户名随便起**,不需要正版登录。

> ⚠️ **别用 `1.21.1-NeoForge` 那个整合包直接连**。实测会报:
> 「您正在尝试连接到一个没有使用 NeoForge 的服务端,但您有模组需要在服务端运行 NeoForge。无法建立连接。」
>
> 原因是 NeoForge 的 `displayTest` 机制:只要有一个模组没声明 `IGNORE_ALL_VERSION` / `IGNORE_SERVER_VERSION`,
> 客户端就拒绝连非 NeoForge 服务端。你这套 38 个模组里**有 29 个**属于这种情况(钠、Iris、旅行地图、
> Xaero 小地图、苹果皮、Jade、锂、BetterF3、机械动力全家桶……),只要有一个在就进不去。
> 详细清单见 `tools\mods-report.txt`(用 `tools\scan-mods.py` 生成)。
>
> 两条出路:① 装个**纯净 1.21.1** 客户端(最省事);② 给服务端也装 **NeoForge + 这些模组**(见第十一节,未完成)。

进去以后在聊天栏输入 `!帮助`,机器人会把指令表发给你。

---

## 二、机器人指令

游戏聊天栏输入(`!` 开头),或者在机器人那个窗口直接敲(不用带 `!`)。中文英文都行。

| 指令 | 作用 |
| --- | --- |
| `!帮助` / `!help` | 指令列表 |
| `!来` / `!come [玩家]` | 走到玩家身边(走到「附近」,不要求站进同一格) |
| `!跟随` / `!follow [玩家]` | 一直跟着玩家(不写名字=跟最近的人) |
| `!停` / `!stop` | 停下手上的事 |
| `!挖 钻石 5` / `!mine diamond_ore 5` | 挖最近的 N 个指定方块 |
| `!矿道 64` / `!strip 64` | 朝当前朝向挖 1×2 矿道,顺手挖沿途矿石、捡掉落物 |
| `!挂机` / `!afk` | 防踢挂机(每 25 秒动一下) |
| `!状态` / `!status` | 位置 / 血量 / 饥饿 / 背包 / 当前任务 |
| `!找矿 [半径]` / `!scan` | 报告附近有哪些矿(默认 32 格) |
| `!背包` / `!inv` | 列出背包物品(太长会自动分几条发) |
| `!清背包` / `!junk` | 丢出圆石/泥土等杂物,腾格子 |
| `!装备` / `!kit` | 领一整套物资并自动穿上护甲(需机器人是 OP) |
| `!穿甲` / `!armor` | 自动穿上背包里最好的护甲 |
| `!去 x y z` / `!goto` | 走到指定坐标附近 |
| `!丢 <物品>` / `!drop` | 丢出背包里的物品 |
| `!说 <文本>` / `!say` | 让机器人念一句话 |

**自动行为**(不用下指令):
- **自动进食**(饥饿 ≤16 就吃,不碰腐肉/毒马铃薯等)
- **自动反击**:5 格内出现僵尸/苦力怕/蜘蛛等敌对生物,自动拔剑贴上去砍
- **死了自动复活**
- **背包快满自动丢杂物**(凝灰岩、泥土、圆石……;钻石/工具/食物/矿物一律保留)
- **断线自动重连**

方块名支持中文别名(钻石、铁矿、远古残骸……)、英文 id(`diamond_ore`)、模糊匹配(`ore` 会匹配所有矿石);挖钻石会自动连 `deepslate_diamond_ore` 一起挖。

---

## 三、不用开游戏也能指挥它

```powershell
cd bot
..\.tools\node\node.exe ask.mjs "!状态"
..\.tools\node\node.exe ask.mjs "!找矿 48" "!背包"
..\.tools\node\node.exe ask.mjs --wait=60000 "!矿道 32"     # 长任务多等一会儿
```

它会以临时玩家 `Asker` 进服,把指令发到聊天栏,再把机器人的回话打印出来。

---

## 四、给自己 OP(想用 `/give`、`/tp` 之类)

机器人 `XiaoMing` 已经是 OP(写在 `server/ops.json`)。你自己想要 OP,两种办法:

1. **服务端控制台**:在服务端那个窗口里输入 `op 你的游戏名`(需要你已进过一次服)。
2. **提前写进 ops.json**(离线模式的 UUID 由名字算出来,不用等进服):
   ```powershell
   cd server
   ..\.tools\node\node.exe setup-ops.mjs 你的游戏名
   ```
   然后重启服务端。

> `ops.json` 里还有个 `TestPlayer`,是自测脚本用的测试账号(它要执行 `/fill`、`/clear`、`/summon`)。不跑自测的话留着也无害,想删掉直接从 `ops.json` 里去掉即可。

---

## 五、参数

### start-bot.ps1

```powershell
.\start-bot.ps1 -Name XiaoMing -Task afk -AutoKit -ServerHost 127.0.0.1 -Port 25565 -Version 1.21.1
```

| 参数 | 说明 |
| --- | --- |
| `-Name` | 机器人游戏名,默认 `XiaoMing` |
| `-Task` | 进服自动执行:`idle`(待命)、`follow`(跟随)、`afk`(挂机)、`strip`(挖矿道)、`mine:diamond_ore` |
| `-AutoKit` | 进服自动领物资 + 穿甲 |
| `-ServerHost` / `-Port` | 想连别人的服务器就改这里 |

`bot.js` 还支持 `--defend=false`(关掉自动反击)、`--reconnect=false`(断开不重连)。

---

## 六、目录结构

```
mcbot\
├─ setup.ps1              从备份恢复:下 Node + 装依赖 + 下服务端
├─ start-all.ps1          一键:服务端 + 机器人(运行时生成)
├─ start-server.ps1       只开服务端(运行时生成)
├─ start-bot.ps1          只开机器人(运行时生成)
├─ bootstrap-npm.mjs      (历史遗留)没有 npm 时从 registry 引导一份
├─ README.md
├─ tools\
│  ├─ fetch.mjs           通用下载器(项目里 Invoke-WebRequest 有 TLS 问题,统一用 node 下)
│  ├─ scan-mods.py        解析模组元数据,判断哪些"服务端必须有"(用 Python 3.11+ tomllib)
│  └─ mods-report.txt     对 1.21.1-NeoForge 那套配置的扫描结果:29 个需要服务端 / 10 个纯客户端
├─ server\                Paper 服务端(setup.ps1 生成)
│  ├─ server.jar           Paper 1.21.1 build 133
│  ├─ server.properties    已设 online-mode=false / enforce-secure-profile=false
│  ├─ eula.txt             已同意 EULA
│  ├─ ops.json             OP 名单(XiaoMing、TestPlayer)
│  ├─ get-paper.mjs        下载 / 换版本的服务端 jar
│  ├─ setup-ops.mjs        写 OP 名单(离线模式 UUID 由名字算出)
│  └─ world\               世界存档(删掉 = 重开档;备份里不含存档)
└─ bot\                   机器人
   ├─ bot.js               入口:连接、重连、事件、自动领物资
   ├─ commands.js          指令、任务、自动进食/反击/整理背包
   ├─ ask.mjs              不开游戏也能下指令
   ├─ selftest.mjs         端到端自测(14 项)
   └─ node_modules\        依赖(setup.ps1 生成)

> 运行时才会出现、**备份里没有**的目录:`.tools\`(Node + npm 缓存)、`bot\node_modules\`、
> `server\server.jar`、`server\libraries`、`server\cache`、`server\world*`。
```

---

## 七、自测(想确认它还正常时跑一下)

服务端和机器人都在跑的时候:

```powershell
cd bot
..\.tools\node\node.exe selftest.mjs
```

它会自己再开一个假人 `TestPlayer` 当「玩家」,逐条发指令并核对机器人的反应,包括:
拿状态 / 领物资 / 走过来 / 跟随 / 停下 / 召唤僵尸看它打不打 / 挖方块 / 用石头把机器人包起来让它挖穿 /
找矿 / 背包 / 挂机。**当前版本 14 项全过。**

---

## 八、换 MC 版本 / 换服务端

机器人和服务端版本必须对得上。

```powershell
cd server
..\.tools\node\node.exe get-paper.mjs 1.21.4      # 下载对应版本的 Paper
```
再把 `start-bot.ps1 -Version` 调好(服务端 1.20.5 以上要 Java 21,以下用 Java 17)。

mineflayer 支持的版本见 `node_modules\minecraft-data`(当前 mineflayer 4.39 支持到 1.21.11 / 26.1)。

---

## 九、常见问题

- **机器人一直重连 / `ECONNREFUSED`**:服务端还没起来,等它打印 `Done (xx.xxs)! For help, type "help"`。
- **机器人进服但你看不到它说话**:`enforce-secure-profile=false` 必须开着(已设好),否则离线模式玩家的聊天会被服务端拒绝。
- **`!装备` 提示不是 OP**:`ops.json` 里的名字要和机器人游戏名完全一致,改完要重启服务端。
- **机器人说「背包满了,没有可丢的杂物」**:36 格全被钻石/矿物这类「要留」的东西塞满了。让它 `!丢 <物品>`、或者你去把东西取走 —— 它会自动丢杂物,但不会舍得丢你的钻石。
- **机器人不跟随**:跟你的人要在已加载区块内(离太远 mineflayer 拿不到 entity),先让它 `!来`。
- **`!矿道` 很慢**:每前进一格它会顺手挖掉周围的矿石、再捡掉落物,所以比一条直线慢;想快就把 `commands.js` 里 `taskStrip` 的 `mineNearbyOres(token, 4, 2)` 改成不挖。
- **机器人被打死了会掉一地东西**:这是原版规则(死亡掉落)。它会自动复活,但背包里的东西留在死亡地点 —— 记得去捡。
- **登录时那句 `PartialReadError`**:1.21.1 的配方包有个已知解析问题,mineflayer 会丢弃该包。已经用 `hideErrors` 静音,不影响任何功能(背包、挖掘、寻路全都实测正常)。
- **端口被占用**:改 `server.properties` 里的 `server-port`,同时给机器人加 `-Port`。
- **想重开档**:停掉服务端,删掉 `server\world`、`world_nether`、`world_the_end` 三个目录,再启动即可。

---

## 十、技术备注

- **为什么以前自带 node.exe**:那台机器上原本没有 Node/npm。现在改成由 `setup.ps1` 下载官方 Node
  (官方 zip 自带 npm,比早期从 registry 引导 npm 的做法干净);`bootstrap-npm.mjs` 是那会的遗留脚本。
- **为什么 bot 是 ESM**:`mineflayer-auto-eat@5` 只支持 ESM,所以用 `type: module` + `createRequire` 兼容其它 CJS 插件。
- **攻击距离**:MC 里近战只有 3 格,所以自动反击会先贴到 3 格内再砍,并按武器攻速(650ms)挥砍 —— 砍太快伤害会被冷却衰减,反而更慢打死。
- **背包空格**:`mineflayer-collectblock` 在背包 0 空位时会去找箱子存东西,本地没有箱子就会抛 `There are no defined chest locations!` 把挖矿搞挂。所以每次挖矿前都会确保有空格,并在抛该错时清一次背包重试。
- **方块 id**:`bot.registry.blocksByName[name].id` 对应的就是 `block.type`(实测核对过),`!挖 石头` 之类按 id 匹配是对的。



