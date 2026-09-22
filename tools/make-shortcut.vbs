' Creates PlanBoard.lnk in the project folder.
' Double-click this file, or run: cscript //nologo tools\make-shortcut.vbs
'
' ASCII only on purpose -- WScript reads scripts as ANSI, so non-ASCII
' characters here would come out garbled on some machines.

Option Explicit

Dim fso, shell, here, root, exePath, icoPath, lnkPath, lnk

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(here)

exePath = fso.BuildPath(root, "node_modules\electron\dist\electron.exe")
icoPath = fso.BuildPath(root, "build\icon.ico")

If Not fso.FileExists(exePath) Then
  WScript.Echo "electron.exe not found:" & vbCrLf & exePath & vbCrLf & _
               "Run 'npm install' in the project folder first."
  WScript.Quit 1
End If

lnkPath = fso.BuildPath(root, "PlanBoard.lnk")

Set lnk = shell.CreateShortcut(lnkPath)
lnk.TargetPath = exePath
lnk.Arguments = """" & root & """"
lnk.WorkingDirectory = root
' Use the app's own icon, not the stock Electron atom. The exe is just the
' generic Electron runtime, so pointing at it shows the wrong icon.
If fso.FileExists(icoPath) Then
  lnk.IconLocation = icoPath & ", 0"
Else
  lnk.IconLocation = exePath & ", 0"
End If
lnk.Description = "PlanBoard"
lnk.Save

WScript.Echo "Created: " & lnkPath
