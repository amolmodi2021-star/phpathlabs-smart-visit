@echo off
setlocal
title PH PathLabs Tally Bridge Installer
set "DEST=%LOCALAPPDATA%\PHPathLabs\TallyBridge"
echo.
echo Installing PH PathLabs Tally Bridge to:
echo   %DEST%
echo.
mkdir "%DEST%" >nul 2>&1
copy /Y "%~dp0PHPathLabs-TallyBridge.exe" "%DEST%\PHPathLabs-TallyBridge.exe" >nul
if not exist "%DEST%\tally-bridge.config.json" (
  copy /Y "%~dp0tally-bridge.config.json" "%DEST%\tally-bridge.config.json" >nul
)
copy /Y "%~dp0README.txt" "%DEST%\README.txt" >nul 2>&1

set "LNK=%USERPROFILE%\Desktop\PH PathLabs Tally Bridge.lnk"
powershell -NoProfile -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%');" ^
  "$s.TargetPath='%DEST%\PHPathLabs-TallyBridge.exe';" ^
  "$s.WorkingDirectory='%DEST%';" ^
  "$s.Description='PH PathLabs TallyPrime bridge';" ^
  "$s.Save()"

echo Installed.
echo Desktop shortcut created.
echo.
echo NEXT:
echo 1. Open TallyPrime with your company loaded (port 9000 enabled).
echo 2. Double-click "PH PathLabs Tally Bridge" on Desktop.
echo 3. In Settings, paste DESKTOP_API_KEY and exact company name, Save.
echo 4. Click "Download and Push to Tally".
echo.
pause
start "" "%DEST%\PHPathLabs-TallyBridge.exe"
