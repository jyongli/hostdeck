#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$taskSource = Split-Path -Parent $PSScriptRoot
& (Join-Path $taskSource 'install.ps1') -NoOpen
# 验证安装入口实际发布的路径，避免只检查执行环境中 Test-Path 的虚拟视图。
$taskBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
$taskKey = $taskBase.OpenSubKey('Software\Google\Chrome\NativeMessagingHosts\cn.hostdeck.bridge')
try { $taskManifestPath = $taskKey.GetValue('') }
finally { $taskKey.Dispose(); $taskBase.Dispose() }
$taskManifest = Get-Content -LiteralPath $taskManifestPath -Raw | ConvertFrom-Json
$taskExpected = Join-Path $taskSource 'native\HostDeck.exe'
if ($taskManifest.path -ne $taskExpected) { throw "安装路径未使用公开的解压目录：$($taskManifest.path)" }
if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'extension\manifest.json'))) { throw '扩展目录不存在' }
Write-Output "安装路径回归通过：$taskManifestPath"
