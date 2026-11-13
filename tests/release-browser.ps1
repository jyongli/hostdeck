#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskRelease = Join-Path $taskRoot ("dist\HostDeck-" + $taskVersion)
$env:HOSTDECK_EXTENSION = Join-Path $taskRelease 'extension'
$env:HOSTDECK_EXE = Join-Path $taskRelease 'native\HostDeck.exe'
$taskBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64')
$taskBackup = @{}
# Scope registration to the test; restore all existing entries even if a test fails.
foreach ($taskVendor in @('Google\Chrome','Google\ChromeForTesting','Chromium')) {
    $taskKeyPath = "Software\$taskVendor\NativeMessagingHosts\cn.hostdeck.bridge"
    $taskKey = $taskBase.OpenSubKey($taskKeyPath)
    try { $taskBackup[$taskKeyPath] = if ($taskKey) { $taskKey.GetValue('') } else { $null } }
    finally { if ($taskKey) { $taskKey.Dispose() } }
}
Push-Location -LiteralPath $taskRoot
try {
    & (Join-Path $taskRelease 'install.ps1') -NoOpen
    foreach ($taskTest in @('tests/browser-smoke.mjs','tests/login-isolation-browser.mjs','tests/session-browser.mjs')) {
        node $taskTest
        if ($LASTEXITCODE) { throw "Browser test failed: $taskTest" }
    }
} finally {
    foreach ($taskKeyPath in $taskBackup.Keys) {
        $taskKey = $taskBase.OpenSubKey($taskKeyPath, $true)
        if ($taskKey) {
            try {
                if ($taskKey.GetValue('') -eq (Join-Path $taskRelease 'native\cn.hostdeck.bridge.json')) {
                    if ($null -ne $taskBackup[$taskKeyPath]) { $taskKey.SetValue('', $taskBackup[$taskKeyPath]) }
                    else { $taskKey.DeleteValue('', $false) }
                }
            } finally { $taskKey.Dispose() }
        }
    }
    $taskBase.Dispose()
    $taskManifest = Join-Path $taskRelease 'native\cn.hostdeck.bridge.json'
    if (Test-Path -LiteralPath $taskManifest) { Remove-Item -LiteralPath $taskManifest }
    Pop-Location
}
