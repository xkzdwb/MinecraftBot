# 启动假人机器人
# 用法:
#   .\start-bot.ps1                          进服后待命
#   .\start-bot.ps1 -Task follow             进服后自动跟随最近的玩家
#   .\start-bot.ps1 -Task afk -AutoKit       挂机 + 自动领物资
#   .\start-bot.ps1 -Name Steve -Task "mine:diamond_ore"

param(
  [string]$Name = 'XiaoMing',
  [string]$Task = 'idle',
  [switch]$AutoKit,
  [string]$ServerHost = '127.0.0.1',
  [int]$Port = 25565,
  [string]$Version = '1.21.1'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$botDir = Join-Path $root 'bot'

# 优先用项目自带的 node,其次用系统 PATH 里的
$node = Join-Path $root '.tools\node\node.exe'
if (-not (Test-Path $node)) {
  $g = Get-Command node -ErrorAction SilentlyContinue
  if ($g) { $node = $g.Source } else { Write-Host "找不到 node.exe" -ForegroundColor Red; exit 1 }
}

Set-Location $botDir
$botArgs = @('bot.js', "--name=$Name", "--host=$ServerHost", "--port=$Port", "--version=$Version", "--task=$Task")
if ($AutoKit) { $botArgs += '--autokit=true' }

Write-Host "启动机器人 $Name -> ${ServerHost}:${Port} (MC $Version),初始任务: $Task" -ForegroundColor Cyan
Write-Host "本窗口可直接敲指令(不带 ! 也行),输入 exit 退出`n" -ForegroundColor Yellow

& $node @botArgs
