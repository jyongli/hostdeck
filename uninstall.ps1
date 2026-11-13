#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$taskExpected = Join-Path $PSScriptRoot 'native\cn.hostdeck.bridge.json'
foreach ($taskVendor in @('Google\Chrome', 'Google\ChromeForTesting', 'Chromium')) {
    $taskPath = "Software\$taskVendor\NativeMessagingHosts\cn.hostdeck.bridge"
    $taskBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
    $taskKey = $taskBase.OpenSubKey($taskPath)
    try { $taskOwned = $taskKey -and $taskKey.GetValue('') -eq $taskExpected }
    finally { if ($taskKey) { $taskKey.Dispose() } }
    if ($taskOwned) { $taskBase.DeleteSubKey($taskPath) }
    $taskBase.Dispose()
}
Write-Host '已移除本目录注册的本机助手。请在 Chrome 扩展管理页移除 HostDeck。'
Write-Host '独立环境的登录数据和文件均已保留，仍在 %LOCALAPPDATA%\HostDeck。'
