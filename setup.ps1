# setup.ps1 —— 一键重建环境
#
# 这个备份里只包含源码/脚本/配置,不含 Node 运行时、依赖和 Paper 服务端。
# 在任意一台 Windows 机器上跑一次这个脚本,就能重新变成可运行状态:
#   1) 下载官方 Node(自带 npm)到 .tools\node
#   2) 用 package-lock.json 安装机器人依赖
#   3) 下载 Paper 服务端 jar
#
# 用法:
#   .\setup.ps1
#   .\setup.ps1 -McVersion 1.21.4 -NodeVersion v22.23.4

param(
  [string]$McVersion = '1.21.1',
  [string]$NodeVersion = 'v24.21.0'   # 实测能跑 mineflayer 的版本
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $root '.tools'
$nodeDir = Join-Path $tools 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'
$npmCmd = Join-Path $nodeDir 'npm.cmd'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---------- 1. Node ----------
Write-Step "1/3 准备 Node 运行时"
if (Test-Path $nodeExe) {
  Write-Host "已有 .tools\node\node.exe,跳过下载"
} else {
  $ver = $NodeVersion.TrimStart('v')
  $zipName = "node-$NodeVersion-win-x64.zip"
  $url = "https://nodejs.org/dist/$NodeVersion/$zipName"
  $zip = Join-Path $tools $zipName
  New-Item -ItemType Directory -Force -Path $tools | Out-Null

  Write-Host "下载 $url"
  $downloaded = $false
  if (Test-Path 'C:\Windows\System32\curl.exe') {
    & 'C:\Windows\System32\curl.exe' -L --fail -o $zip $url
    if ($LASTEXITCODE -eq 0 -and (Test-Path $zip)) { $downloaded = $true }
  }
  if (-not $downloaded) {
    Write-Host "curl 失败,改用 Invoke-WebRequest"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  }
  if (-not (Test-Path $zip)) { throw "下载 Node 失败,请手动去 https://nodejs.org/dist/ 下载 $zipName 放到 .tools 下" }

  Write-Host "解压 ..."
  $tmp = Join-Path $tools '_unzip'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (-not $inner) { throw "解压结果异常" }
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Move-Item $inner.FullName $nodeDir
  Remove-Item $tmp -Recurse -Force
  Remove-Item $zip -Force
  Write-Host "Node 就绪: $nodeExe"
}

& $nodeExe --version
if (-not (Test-Path $npmCmd)) { throw "这份 Node 里没找到 npm.cmd" }

# ---------- 2. 依赖 ----------
Write-Step "2/3 安装机器人依赖"
$botDir = Join-Path $root 'bot'
Push-Location $botDir
try {
  $env:npm_config_cache = Join-Path $tools 'npm-cache'   # 缓存也放项目里,不污染系统
  $env:npm_config_update_notifier = 'false'
  $env:npm_config_fund = 'false'
  $env:npm_config_audit = 'false'

  if (Test-Path 'package-lock.json') {
    Write-Host "用 package-lock.json 精确安装(npm ci)..."
    & $npmCmd ci
    if ($LASTEXITCODE -ne 0) {
      Write-Host "npm ci 失败,改用 npm install" -ForegroundColor Yellow
      & $npmCmd install
    }
  } else {
    & $npmCmd install
  }
  if ($LASTEXITCODE -ne 0) { throw "依赖安装失败" }
} finally { Pop-Location }

# ---------- 3. 服务端 ----------
Write-Step "3/3 准备 Paper 服务端 (MC $McVersion)"
$serverDir = Join-Path $root 'server'
New-Item -ItemType Directory -Force -Path $serverDir | Out-Null
Push-Location $serverDir
try {
  if (Test-Path 'server.jar') {
    Write-Host "server.jar 已存在,跳过"
  } else {
    & $nodeExe 'get-paper.mjs' $McVersion
    if ($LASTEXITCODE -ne 0) { throw "下载服务端失败" }
  }
  if (-not (Test-Path 'eula.txt')) {
    Write-Host "创建 eula.txt(继续启动即表示同意 Minecraft EULA: https://aka.ms/MinecraftEULA)" -ForegroundColor Yellow
    Set-Content -Path 'eula.txt' -Value "eula=true" -Encoding ascii
  }
} finally { Pop-Location }

# ---------- 收尾检查 ----------
Write-Step "环境检查"
$java = $null
foreach ($c in @(Get-ChildItem 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -like 'jdk-21*' } |
                 ForEach-Object { Join-Path $_.FullName 'bin\java.exe' })) {
  if (Test-Path $c) { $java = $c; break }
}
if ($java) { Write-Host "Java: $java" -ForegroundColor Green }
else { Write-Host "警告: 没找到 Java 21,服务端起不来。请安装 JDK 21。" -ForegroundColor Red }

Write-Host -ForegroundColor Green @"

完成!接下来:
  .\start-all.ps1            开服务端 + 机器人
  .\start-server.ps1         只开服务端
  .\start-bot.ps1            只开机器人

游戏里输入 !帮助 看机器人指令。
"@
