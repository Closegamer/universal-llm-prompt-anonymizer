!macro customUnInstall
  ; Stop the tray app so it cannot restart the proxy while files are removed.
  nsExec::Exec 'taskkill /IM "Universal LLM Prompt Anonymizer.exe" /F'
  Pop $0

  ; Stop the bundled proxy and remove the OpenCode plugin the app installed.
  nsExec::Exec '"$INSTDIR\resources\proxy\node\node.exe" "$INSTDIR\resources\proxy\proxy-runtime\src\cli.js" stop'
  Pop $0
  RMDir /r "$PROFILE\.config\opencode\plugins\universal-llm-prompt-anonymizer"

  ; Remove the auto-start entry created by the app.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Universal LLM Prompt Anonymizer"
!macroend
