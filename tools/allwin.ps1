$sig = @'
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public class AW{
  [DllImport("user32.dll")] static extern bool EnumWindows(CB l,IntPtr p);
  delegate bool CB(IntPtr h,IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  public static List<string> Go(){ var r=new List<string>();
    EnumWindows((h,l)=>{ if(!IsWindowVisible(h))return true; var sb=new StringBuilder(400);
      GetWindowTextW(h,sb,400); uint pid; GetWindowThreadProcessId(h,out pid);
      if(sb.Length>0) r.Add(pid+" :: "+sb.ToString()); return true; }, IntPtr.Zero);
    return r; }
}
'@
Add-Type -TypeDefinition $sig
[AW]::Go() | ForEach-Object { [Console]::OutputEncoding=[Text.Encoding]::UTF8; $_ }
