$sig = @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class NE{
  [DllImport("user32.dll")] static extern bool EnumWindows(CB l,IntPtr p);
  delegate bool CB(IntPtr h,IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowTextW(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  public static List<string> Go(){
    var r=new List<string>();
    EnumWindows((h,l)=>{ if(!IsWindowVisible(h))return true;
      var sb=new StringBuilder(512); GetWindowTextW(h,sb,512);
      uint pid=0; GetWindowThreadProcessId(h,out pid);
      if(sb.Length>0) r.Add(pid+" | "+sb.ToString());
      return true; }, IntPtr.Zero);
    return r;
  }
}
'@
Add-Type -TypeDefinition $sig
[NE]::Go() | Where-Object { $_ -match '探针|WebView|github' }
'--- powershell 进程 ---'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object { "$($_.ProcessId) | $($_.CommandLine)" } | Where-Object { $_ -match 'host.ps1' }
