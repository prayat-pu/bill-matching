' Put a hidden-launch shortcut to start.cmd in the Startup folder.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set link = shell.CreateShortcut(shell.SpecialFolders("Startup") & "\Bill Matching.lnk")
link.TargetPath = "wscript.exe"
link.Arguments = """" & here & "\start-hidden.vbs"""
link.WorkingDirectory = here
link.Description = "Bill reconciliation server"
link.Save
