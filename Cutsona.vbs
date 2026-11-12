' Cutsona launcher: starts Cutsona with no console window.
' The Cutsona engine runs in the background and closes itself when you close the Cutsona window.
' What it prints goes to cutsona.log in this folder (handy if something goes wrong).
Option Explicit
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Cutsona needs Node.js to run." & vbCrLf & vbCrLf & "Get it free from https://nodejs.org, install it, then open Cutsona again.", vbExclamation, "Cutsona"
  WScript.Quit 1
End If

' start the engine, hidden (window style 0), and don't wait for it
sh.Run "cmd /c node """ & dir & "\server.js"" > """ & dir & "\cutsona.log"" 2>&1", 0, False

If sh.Run("cmd /c where ffmpeg >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Cutsona is opening, but ffmpeg isn't installed, so finished videos can't be saved yet." & vbCrLf & vbCrLf & _
    "To install it, open Command Prompt and run:" & vbCrLf & "    winget install Gyan.FFmpeg" & vbCrLf & "then open Cutsona again.", vbInformation, "Cutsona"
End If
