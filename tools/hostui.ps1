# Host OUR OWN re-laid-out page inside WebView2 (not GitHub's page).
# ASCII only: Windows PowerShell 5.1 reads .ps1 as ANSI/GBK, so non-ASCII literals break parsing.
param([string]$File = 'layout.html')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir  = Join-Path (Split-Path -Parent $root) 'measurements'
$env:PATH = "$root\x\runtimes\win-x64\native;$env:PATH"

$global:WvDir  = $dir
$global:WvFile = $File
$global:WvLog  = Join-Path $root 'hostui.log'
$global:WvUdf  = Join-Path $root 'udf'
New-Item -ItemType Directory -Force -Path $global:WvUdf | Out-Null
Set-Content -Path $global:WvLog -Value '--- relayout UI host ---'
Add-Content $global:WvLog "pid=$PID file=$File dir=$dir"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Path "$root\x\lib\net462\Microsoft.Web.WebView2.Core.dll"
Add-Type -Path "$root\x\lib\net462\Microsoft.Web.WebView2.WinForms.dll"

[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = 'Relayout experiment - our own card UI (page parse + API curve)'
$form.Width = 1180
$form.Height = 900
$form.StartPosition = 'Manual'
$form.Location = New-Object Drawing.Point(40, 30)

$wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$wv.Dock = 'Fill'
$form.Controls.Add($wv)
$global:WvControl = $wv

$form.Add_FormClosing({ Add-Content $global:WvLog "FORM CLOSING $($EventArgs.CloseReason)" })

$form.Add_Shown({
  try {
    $log = $global:WvLog
    $ctl = $global:WvControl
    $opts = New-Object Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions -ArgumentList `
      @('--proxy-server=127.0.0.1:7890', $null, $null, $false, $null)
    $t1 = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null, $global:WvUdf, $opts)
    while (-not $t1.Wait(100)) { [Windows.Forms.Application]::DoEvents() }
    $env2 = $t1.Result
    Add-Content $log "env ok $($env2.BrowserVersionString)"

    $t2 = $ctl.EnsureCoreWebView2Async($env2)
    while (-not $t2.Wait(100)) { [Windows.Forms.Application]::DoEvents() }
    $cv = $ctl.CoreWebView2

    $kind = [Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::Allow
    $cv.SetVirtualHostNameToFolderMapping('probe.local', $global:WvDir, $kind)
    Add-Content $log 'virtual host mapped'

    $null = Register-ObjectEvent -InputObject $cv -EventName NavigationCompleted -MessageData $log -Action {
      Add-Content $Event.MessageData ("NavigationCompleted success={0} status={1}" -f $EventArgs.IsSuccess, $EventArgs.HttpStatusCode)
    }
    $cv.Navigate("https://probe.local/$($global:WvFile)")
    Add-Content $log "navigated https://probe.local/$($global:WvFile)"
  } catch {
    Add-Content $global:WvLog ("EXCEPTION: " + $_.Exception.Message)
  }
})

[Windows.Forms.Application]::Run($form)
Add-Content $global:WvLog 'exited'
