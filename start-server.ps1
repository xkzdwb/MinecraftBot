# 启动本地 Minecraft 服务端(Paper 1.21.1)
# 用法: 右键「使用 PowerShell 运行」,或在终端里 .\start-server.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $root 'server'
Set-Location $serverDir

if (-not (Test-Path 'server.jar')) { Write-Host "缺少 server.jar,先运行: node get-paper.mjs 1.21.1" -ForegroundColor Red; exit 1 }
if (-not (Test-Path 'eula.txt'))  { Write-Host "缺少 eula.txt" -ForegroundColor Red; exit 1 }

# 找 Java 21(Paper 1.21.1 需要 Java 21)
$java = $null
$cands = @(Get-ChildItem 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -like 'jdk-21*' } |
           ForEach-Object { Join-Path $_.FullName 'bin\java.exe' })
$cands += @(Get-ChildItem 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'bin\java.exe' })
$cands += @(Get-ChildItem "$env:APPDATA\.minecraft\runtime" -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'bin\java.exe' })
foreach ($c in $cands) { if (Test-Path $c) { $java = $c; break } }
if (-not $java) { $g = Get-Command java -ErrorAction SilentlyContinue; if ($g) { $java = $g.Source } }
if (-not $java) { Write-Host "找不到 Java,请安装 JDK 21" -ForegroundColor Red; exit 1 }

Write-Host "使用 Java: $java" -ForegroundColor Cyan
Write-Host "服务端目录: $serverDir" -ForegroundColor Cyan
Write-Host "启动后本窗口就是服务器控制台,可以输入 op 你的游戏名 / stop 等命令`n" -ForegroundColor Yellow

& $java -Xms1G -Xmx2G -jar server.jar nogui
