param([string]$Match = 'Relayout experiment', [string]$Out = 'win.png')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$sig = @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class WT{
  [DllImport("user32.dll")] static extern bool EnumWindows(CB l,IntPtr p);
  delegate bool CB(IntPtr h,IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out R r);
  [StructLayout(LayoutKind.Sequential)] public struct R{public int L;public int T;public int Rt;public int B;}
  public static List<string> Find(string needle){
    var outp=new List<string>();
    EnumWindows((h,l)=>{ if(!IsWindowVisible(h))return true;
      var sb=new StringBuilder(512); GetWindowTextW(h,sb,512);
      if(sb.ToString().Contains(needle)){ R r; GetWindowRect(h,out r);
        outp.Add(h.ToInt64()+"|"+r.L+"|"+r.T+"|"+(r.Rt-r.L)+"|"+(r.B-r.T)); }
      return true; }, IntPtr.Zero);
    return outp;
  }
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
$found = [WT]::Find($Match)
if (-not $found -or $found.Count -eq 0) { Write-Output "NO WINDOW matching '$Match'"; exit 1 }
Write-Output ("windows: " + ($found -join '  '))
$h = [IntPtr][int64](($found[0] -split '\|')[0])
$p = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) $Out
[WT]::Grab($h, $p)
Write-Output "saved $Out"
