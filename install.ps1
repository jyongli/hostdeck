#requires -Version 5.1
param([switch]$NoOpen, [switch]$InPlace)
$ErrorActionPreference = 'Stop'
$taskSource = $PSScriptRoot
# 默认在解压目录注册。AppData 写入在打包应用环境中可能重定向到私有目录，
# Test-Path 成功也不能证明外部 Explorer/Chrome 能按同一别名找到文件。
# 保留 -InPlace 参数以兼容旧调用；目前所有安装都使用原地注册。
$taskDestination = $taskSource
if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'native\HostDeck.exe'))) { throw '请先构建或使用完整发行包' }
$taskManifestPath = Join-Path $taskDestination 'native\cn.hostdeck.bridge.json'
$taskManifest = @{
    name = 'cn.hostdeck.bridge'; description = 'HostDeck local bridge'; type = 'stdio'
    path = (Join-Path $taskDestination 'native\HostDeck.exe')
    allowed_origins = @('chrome-extension://lfpancneciaghohokolpmdfmokmlkblp/')
}
[IO.File]::WriteAllText($taskManifestPath, ($taskManifest | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
# 只注册本工具的当前用户助手，不需要管理员或系统网络设置。
foreach ($taskVendor in @('Google\Chrome', 'Google\ChromeForTesting', 'Chromium')) {
    $taskKeyPath = "Software\$taskVendor\NativeMessagingHosts\cn.hostdeck.bridge"
    $taskBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
    $taskKey = $taskBase.CreateSubKey($taskKeyPath)
    try {
        $taskPrevious = $taskKey.GetValue('')
        if ($taskPrevious -and $taskPrevious -ne $taskManifestPath) {
            $taskExisting = Get-Content -LiteralPath $taskPrevious -Raw | ConvertFrom-Json
            if ($taskExisting.name -ne 'cn.hostdeck.bridge' -or $taskExisting.allowed_origins -notcontains 'chrome-extension://lfpancneciaghohokolpmdfmokmlkblp/') {
                throw "现有注册项不属于 HostDeck：$taskKeyPath"
            }
        }
        $taskKey.SetValue('', $taskManifestPath, [Microsoft.Win32.RegistryValueKind]::String)
    } finally { $taskKey.Dispose(); $taskBase.Dispose() }
}
$taskExtension = Join-Path $taskDestination 'extension'
Write-Host "本机助手已注册。扩展目录：$taskExtension"
Write-Host '使用期间请保留此解压目录，不要移动或删除。'
Write-Host '在 Chrome 扩展管理页开启开发者模式，点击「加载已解压的扩展程序」，选择上述 extension 文件夹。'
Write-Host '扩展 ID 应为：lfpancneciaghohokolpmdfmokmlkblp'
if (-not $NoOpen) {
    $taskChrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($taskChrome) { Start-Process -FilePath $taskChrome -ArgumentList 'chrome://extensions/' }
    Start-Process -FilePath explorer.exe -ArgumentList ('"' + $taskExtension + '"')
}
