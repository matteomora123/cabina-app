@echo off
echo Fermando il backend (uvicorn)...
taskkill /F /IM uvicorn.exe >nul 2>&1

echo Fermando il microservizio AI (uvicorn ai_microservice)...
taskkill /F /IM uvicorn.exe >nul 2>&1

echo Fermando il frontend (node/npm)...
taskkill /F /IM node.exe >nul 2>&1

echo Tutto fermato.
pause
