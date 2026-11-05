# 一键启动:先开服务端(新窗口),等端口通了再开机器人(当前窗口)
# 用法: .\start-all.ps1            机器人进服待命
#       .\start-all.ps1 -Task afk  机器人进服挂机

param(
  [string]$Task = 'idle',
  [string]$Name = 'XiaoMing',
  [switch]$AutoKit
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '[1/2] 在新窗口启动服务端 ...' -ForegroundColor Cyan
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'start-server.ps1')
)

Write-Host '等待服务端监听 25565 端口(首次生成世界可能要 1~2 分钟)...' -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 150; $i++) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', 25565)
    $c.Close()
    $ready = $true
    break
  } catch { Start-Sleep -Seconds 2 }
}

if (-not $ready) { Write-Host '等不到服务端,请检查另一个窗口的报错' -ForegroundColor Red; exit 1 }
Write-Host '服务端已就绪!' -ForegroundColor Green

Write-Host '[2/2] 启动机器人 ...' -ForegroundColor Cyan
$botArgs = @('-Task', $Task, '-Name', $Name)
if ($AutoKit) { $botArgs += '-AutoKit' }
& (Join-Path $root 'start-bot.ps1') @botArgs
