:: generacontesto.bat
@echo off
setlocal enabledelayedexpansion

set "ROOT=%cd%"
if not "%~1"=="" set "ROOT=%~1"

set "SCRIPT_DIR=%~dp0"

for /f %%i in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyyMMdd\")"') do set "DATESTR=%%i"

set "N=1"
:find_free_name
set "OUTFILE=%DATESTR%_!N!.txt"
if exist "%OUTFILE%" (
  set /a N+=1
  goto find_free_name
)

echo Genero "%OUTFILE%" da "%ROOT%"...
python "%SCRIPT_DIR%generate_project_summary.py" "%ROOT%" "%OUTFILE%"
if errorlevel 1 (
  echo Errore durante la generazione.
  exit /b 1
)
echo Fatto: "%OUTFILE%"
endlocal
