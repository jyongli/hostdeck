#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $taskVswhere)) { throw 'Install Visual Studio C++ Build Tools and a Windows SDK.' }
$taskVs = & $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $taskVs) { throw 'Visual Studio C++ x64 Build Tools were not found.' }
$env:HostDeckVc = Join-Path $taskVs 'VC\Auxiliary\Build\vcvars64.bat'
$taskDistribution = Join-Path $taskRoot ("dist\HostDeck-" + $taskVersion)
New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot 'output'), (Join-Path $taskDistribution 'native') | Out-Null
Set-Content -LiteralPath (Join-Path $taskRoot 'output\version.h') -Encoding ascii -Value ('#define HOSTDECK_VERSION "' + $taskVersion + '"')
Push-Location -LiteralPath $taskRoot
try {
    # VC 支持代码静态链接，通用 CRT 复用 Windows 10/11 自带组件。
    cmd.exe /d /c 'call "%HostDeckVc%" >nul && cl /nologo /std:c++17 /O1 /GL /Gy /Gw /MT /EHsc /utf-8 /DNDEBUG /Ioutput /Fooutput/hostdeck.obj native/host.cpp /link /LTCG /OPT:REF,ICF /INCREMENTAL:NO /SUBSYSTEM:WINDOWS /NODEFAULTLIB:libucrt.lib /OUT:output/HostDeck.exe ucrt.lib bcrypt.lib ws2_32.lib shell32.lib'
    if ($LASTEXITCODE) { throw 'Native build failed.' }
    node scripts/minify.mjs $taskDistribution
    if ($LASTEXITCODE) { throw 'Extension build failed. Run npm ci first.' }
    Copy-Item -LiteralPath 'output\HostDeck.exe','native\vendor\LICENSE.txt' -Destination (Join-Path $taskDistribution 'native') -Force
    # 新文件名避开旧版正在使用的桥接程序。
    Copy-Item -LiteralPath 'output\HostDeck.exe' -Destination 'native\HostDeck.exe' -Force
    $taskPreviousBuild = Join-Path $taskDistribution 'native\HostDeckBridge.exe'
    if (Test-Path -LiteralPath $taskPreviousBuild) { Remove-Item -LiteralPath $taskPreviousBuild }
} finally { Pop-Location; Remove-Item Env:HostDeckVc -ErrorAction SilentlyContinue }
Write-Output "Build: $taskDistribution"
