#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskIconRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension\icons'
New-Item -ItemType Directory -Force -Path $taskIconRoot | Out-Null
# 代码生成的简洁标识，避免为扩展图标引入外部素材或运行时依赖。
foreach ($taskSize in @(16, 32, 48, 128)) {
    $taskBitmap = New-Object Drawing.Bitmap($taskSize, $taskSize)
    $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
    $taskGraphics.SmoothingMode = 'AntiAlias'
    $taskGraphics.TextRenderingHint = 'AntiAliasGridFit'
    $taskGraphics.Clear([Drawing.Color]::FromArgb(30, 58, 138))
    $taskFont = New-Object Drawing.Font('Segoe UI', ($taskSize * 0.67), [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $taskFormat = New-Object Drawing.StringFormat
    $taskFormat.Alignment = 'Center'; $taskFormat.LineAlignment = 'Center'
    $taskRect = New-Object Drawing.RectangleF(0, (-$taskSize * 0.02), $taskSize, $taskSize)
    $taskGraphics.DrawString('H', $taskFont, [Drawing.Brushes]::White, $taskRect, $taskFormat)
    $taskBitmap.Save((Join-Path $taskIconRoot "icon$taskSize.png"), [Drawing.Imaging.ImageFormat]::Png)
    $taskFormat.Dispose(); $taskFont.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
}
