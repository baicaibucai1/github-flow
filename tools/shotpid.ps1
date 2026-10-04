# Capture OUR OWN window by process id: find its HWND, bring it to the front, then grab its rect.
# Matching by pid avoids false positives from other apps whose titles contain the same words,
# and foregrounding avoids capturing whatever else happens to be painted on top.
param([int]$ProcId = 0, [string]$Out = 'app.png')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$sig = @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class SH{
  [DllImport("user32.dll")] static extern bool EnumWindows(CB l,IntPtr p);
  delegate bool CB(IntPtr h,IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out R r);
  [StructLayout(LayoutKind.Sequential)] public struct R{public int L;public int T;public int Rt;public int B;}
  public static List<string> ForPid(uint target){
    var r=new List<string>();
    EnumWindows((h,l)=>{
      uint pid; GetWindowThreadProcessId(h,out pid);
      if(pid!=target || !IsWindowVisible(h)) return true;
      var sb=new StringBuilder(400); GetWindowTextW(h,sb,400);
      if(sb.Length==0) return true;
      R rc; GetWindowRect(h,out rc);
      r.Add(h.ToInt64()+"|"+sb.ToString()+"|"+rc.L+"|"+rc.T+"|"+(rc.Rt-rc.L)+"|"+(rc.B-rc.T));
      return true; }, IntPtr.Zero);
    return r;
  }
  public static void Raise(IntPtr h){ ShowWindow(h,9); SetForegroundWindow(h); }
  public static void Grab(IntPtr h,string file){
    R r; GetWindowRect(h,out r);
    int w=r.Rt-r.L, ht=r.B-r.T;
    var bmp=new System.Drawing.Bitmap(w,ht);
    var g=System.Drawing.Graphics.FromImage(bmp);
    g.CopyFromScreen(r.L,r.T,0,0,new System.Drawing.Size(w,ht));
    bmp.Save(file); g.Dispose(); bmp.Dispose();
  }
}
'@
Add-Type -TypeDefinition $sig -ReferencedAssemblies System.Drawing
if ($ProcId -eq 0) {
  $p = Get-Process ghfind -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { Write-Output 'NO ghfind PROCESS'; exit 1 }
  $ProcId = $p.Id
}
$wins = [SH]::ForPid([uint32]$ProcId)
if (-not $wins -or $wins.Count -eq 0) { Write-Output "NO WINDOW for pid $ProcId"; exit 1 }
$wins | ForEach-Object { Write-Output "win: $_" }
$h = [IntPtr][int64](($wins[0] -split '\|')[0])
[SH]::Raise($h)
Start-Sleep -Milliseconds 900
[SH]::Raise($h)
Start-Sleep -Milliseconds 600
$out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) $Out
[SH]::Grab($h, $out)
Write-Output "saved $out"
