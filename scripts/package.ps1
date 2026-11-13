#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskStage = Join-Path $taskRoot ("dist\HostDeck-" + $taskVersion)
if (-not (Test-Path -LiteralPath (Join-Path $taskStage 'native\HostDeck.exe'))) { throw '请先运行 npm run build' }
# 仅刷新文档和安装入口；已验收的扩展、运行时和可执行文件保持原字节。
Copy-Item -Path (Join-Path $taskRoot 'docs\*') -Destination (Join-Path $taskStage 'docs') -Force
foreach ($taskFile in @('README.md', 'install.ps1', 'uninstall.ps1', '安装.cmd', '卸载助手.cmd', 'start-chrome.ps1', '隐藏调试提示启动Chrome.cmd')) {
    Copy-Item -LiteralPath (Join-Path $taskRoot $taskFile) -Destination $taskStage -Force
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskPackage = Join-Path $taskRoot ("dist\HostDeck-" + $taskVersion + '-win-x64.zip')
if (Test-Path -LiteralPath $taskPackage) { Remove-Item -LiteralPath $taskPackage }
[IO.Compression.ZipFile]::CreateFromDirectory($taskStage, $taskPackage, [IO.Compression.CompressionLevel]::Optimal, $true)
$taskZip = [IO.Compression.ZipFile]::OpenRead($taskPackage)
try {
    foreach ($taskEntry in $taskZip.Entries) {
        if ($taskEntry.FullName -match '(^|[/\\])(output|node_modules|\.git)([/\\])|test-key|cn\.hostdeck\.bridge\.json') {
            throw "发行包含有不应包含的文件：$($taskEntry.FullName)"
        }
        if ($taskEntry.FullName -match '[/\\]native[/\\]' -and $taskEntry.Name -notin @('HostDeck.exe','LICENSE.txt','')) {
            throw "Unexpected native file: $($taskEntry.FullName)"
        }
    }
    if (-not ($taskZip.Entries | Where-Object { $_.FullName -match 'extension[/\\]manifest.json$' })) { throw '缺少扩展 manifest' }
} finally { $taskZip.Dispose() }
$taskHashStream = [IO.File]::OpenRead($taskPackage)
$taskHasher = [Security.Cryptography.SHA256]::Create()
try { $taskHash = ([BitConverter]::ToString($taskHasher.ComputeHash($taskHashStream))).Replace('-', '').ToLowerInvariant() }
finally { $taskHashStream.Dispose(); $taskHasher.Dispose() }
[IO.File]::WriteAllText(($taskPackage + '.sha256'), ($taskHash + '  ' + [IO.Path]::GetFileName($taskPackage) + [Environment]::NewLine))
Write-Output "发行包：$taskPackage"
Write-Output "SHA256：$taskHash"

# 源码包走白名单：不带运行时、历史产物、浏览器资料和测试凭据。
$taskSourceZip = Join-Path $taskRoot ("dist\HostDeck-" + $taskVersion + '-source.zip')
if (Test-Path -LiteralPath $taskSourceZip) { Remove-Item -LiteralPath $taskSourceZip }
$taskSourceArchive = [IO.Compression.ZipFile]::Open($taskSourceZip, [IO.Compression.ZipArchiveMode]::Create)
try {
    $taskSourceFiles = @(
        'package.json', 'package-lock.json', '.gitignore', 'README.md', 'install.ps1', 'uninstall.ps1',
        '安装.cmd', '卸载助手.cmd', 'start-chrome.ps1', '隐藏调试提示启动Chrome.cmd',
        'native/host.cpp', 'native/vendor/picojson.h', 'native/vendor/LICENSE.txt'
    )
    foreach ($taskDir in @('extension', 'scripts', 'tests', 'docs')) {
        $taskSourceFiles += Get-ChildItem -LiteralPath (Join-Path $taskRoot $taskDir) -Recurse -File |
            ForEach-Object { $_.FullName.Substring($taskRoot.Length + 1).Replace('\','/') }
    }
    foreach ($taskFile in $taskSourceFiles) {
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $taskSourceArchive, (Join-Path $taskRoot $taskFile), ("HostDeck-$taskVersion-source/" + $taskFile),
            [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $taskSourceArchive.Dispose() }
Write-Output "Source: $taskSourceZip"
