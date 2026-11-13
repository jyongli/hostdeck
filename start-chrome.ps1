#requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference = 'Stop'
$taskCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$taskChrome = $taskCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskChrome) { throw '未找到 Google Chrome。' }

# 不指定新的用户数据目录，沿用原 Chrome 的账号、书签、密码和网站登录。
# 已运行的 Chrome 会忽略新启动参数，因此只检查并提示，不自动结束用户进程。
if ($PSCmdlet.ShouldProcess($taskChrome, '使用原 Chrome 配置启动，并隐藏本次所有扩展的调试提示')) {
    if (Get-Process -Name chrome -ErrorAction SilentlyContinue) {
        throw '请先保存工作并退出全部 Chrome 窗口（包括独立环境窗口），再运行此入口。工具不会替你关闭浏览器。'
    }
    Start-Process -FilePath $taskChrome -ArgumentList '--silent-debugger-extension-api' -WindowStyle Normal
    Write-Output 'Chrome 已按隐藏调试提示的方式启动，继续使用原来的账户资料。'
}
