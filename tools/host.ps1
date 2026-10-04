# WebView2 承载探针：不经 Rust，直接用 .NET WinForms 控件 + 本机已装的 WebView2 运行时。
# 要证明的三件事：
#   1) github.com 能否作为顶层文档在内嵌 WebView 里加载（CSP frame-ancestors 管不到顶层文档）
#   2) 导航事件能否被宿主拦截/记账（产品里"他跳出了 github.com" 的观测点）
#   3) 登录 cookie / 缓存落在哪个目录（上一轮标"未核实"的那条代价）
param([string]$Url = 'https://github.com/vitejs/vite')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$root\x\runtimes\win-x64\native;$env:PATH"   # 让 LoadLibrary 找得到 WebView2Loader.dll

$global:WvUrl = $Url
$global:WvRoot = $root
$global:WvLog = Join-Path $root 'host.log'
$global:WvUdf = Join-Path $root 'udf'
New-Item -ItemType Directory -Force -Path $global:WvUdf | Out-Null
Set-Content -Path $global:WvLog -Value '--- WebView2 host probe ---'
Add-Content $global:WvLog "pid=$PID  url=$global:WvUrl"
Add-Content $global:WvLog "user-data-folder=$global:WvUdf"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Path "$root\x\lib\net462\Microsoft.Web.WebView2.Core.dll"
Add-Type -Path "$root\x\lib\net462\Microsoft.Web.WebView2.WinForms.dll"
Add-Content $global:WvLog 'assembly loaded ok'

[Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object Windows.Forms.Form
$form.Text = '内置浏览器探针 (WebView2/.NET) - github.com'
$form.Width = 1280
$form.Height = 860
$form.StartPosition = 'Manual'
$form.Location = New-Object Drawing.Point(60, 50)

$wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$wv.Dock = 'Fill'
$form.Controls.Add($wv)
$global:WvControl = $wv

$form.Add_FormClosing({ Add-Content $global:WvLog "FORM CLOSING reason=$($EventArgs.CloseReason)" })
$form.Add_FormClosed({ Add-Content $global:WvLog 'FORM CLOSED' })

$form.Add_Shown({
  try {
    $log = $global:WvLog
    $udf = $global:WvUdf
    $ctl = $global:WvControl

    # 该类型没有无参构造，必须按 (args, language, targetVersion, sso, schemeList) 全给
    $opts = New-Object Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions -ArgumentList `
      @('--proxy-server=127.0.0.1:7890', $null, $null, $false, $null)
    # 本机 github.com 直连被重置，显式走本地代理：确保失败原因是"能不能内嵌"而不是"网不通"
    Add-Content $log 'browser-args=--proxy-server=127.0.0.1:7890'

    # 同步等 Task 但持续泵消息，避开 WinForms 上的经典死锁
    $t1 = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($null, $udf, $opts)
    while (-not $t1.Wait(100)) { [Windows.Forms.Application]::DoEvents() }
    $env2 = $t1.Result
    Add-Content $log "environment ok  BrowserVersion=$($env2.BrowserVersionString)"

    $t2 = $ctl.EnsureCoreWebView2Async($env2)
    while (-not $t2.Wait(100)) { [Windows.Forms.Application]::DoEvents() }
    $cv = $ctl.CoreWebView2
    Add-Content $log 'CoreWebView2 ready'

    $null = Register-ObjectEvent -InputObject $cv -EventName NavigationStarting -MessageData $log -Action {
      Add-Content $Event.MessageData ("NavigationStarting {0} userInitiated={1} cancel={2}" -f $EventArgs.Uri, $EventArgs.IsUserInitiated, $EventArgs.Cancel)
    }
    $null = Register-ObjectEvent -InputObject $cv -EventName NavigationCompleted -MessageData $log -Action {
      Add-Content $Event.MessageData ("NavigationCompleted success={0} httpStatus={1}" -f $EventArgs.IsSuccess, $EventArgs.HttpStatusCode)
    }
    $null = Register-ObjectEvent -InputObject $cv -EventName DocumentTitleChanged -MessageData $log -Action {
      Add-Content $Event.MessageData ("DocumentTitleChanged """ + $Event.Sender.DocumentTitle + """")
    }

    $cv.Navigate($global:WvUrl)
    Add-Content $log 'Navigate() called'
  } catch {
    Add-Content $global:WvLog ("EXCEPTION: " + $_.Exception.ToString())
  }
})

Add-Content $global:WvLog 'entering message loop'
[Windows.Forms.Application]::Run($form)
Add-Content $global:WvLog 'message loop exited'
