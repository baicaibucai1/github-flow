param([string]$Out = 'shot.png')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
$g = [Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
$bmp.Save((Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) $Out))
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $Out $($b.Width)x$($b.Height)"
