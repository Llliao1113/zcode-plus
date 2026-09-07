' ZCode+ hidden launcher: run controller.mjs without a console window
' Log file: zcode-plus.log in the same directory
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
installDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node """ & installDir & "\controller.mjs""", 0, False
