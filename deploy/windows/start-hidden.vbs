' Launch start.cmd with no console window, for the scheduled task.
Set shell = CreateObject("WScript.Shell")
shell.Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\start.cmd""", 0, False
