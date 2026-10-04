$ErrorActionPreference='Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$root\x\runtimes\win-x64\native;$env:PATH"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Path "$root\x\lib\net462\Microsoft.Web.WebView2.Core.dll"
foreach($n in 'CoreWebView2EnvironmentOptions','CoreWebView2Environment'){
  $t=[Type]("Microsoft.Web.WebView2.Core.$n")
  Write-Output ("### " + $n)
  $t.GetConstructors([System.Reflection.BindingFlags]::Public -bor [System.Reflection.BindingFlags]::Instance) | ForEach-Object {
    Write-Output ("  ctor(" + (($_.GetParameters() | ForEach-Object { $_.ParameterType.Name + ' ' + $_.Name }) -join ', ') + ")")
  }
  Write-Output '  --- static Create* ---'
  $t.GetMethods() | Where-Object { $_.IsStatic -and $_.Name -like 'Create*' } | ForEach-Object {
    Write-Output ("  " + $_.Name + "(" + (($_.GetParameters() | ForEach-Object { $_.ParameterType.Name }) -join ', ') + ")")
  }
}
