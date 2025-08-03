@echo off
echo Avvio Backend (FastAPI)...
start cmd /k "cd /d C:\Users\matte\PycharmProjects\cabina-app\backend && uvicorn main:app --reload"

echo Avvio Microservizio AI (porta 9000)...
start cmd /k "cd /d C:\Users\matte\PycharmProjects\cabina-app\backend && uvicorn ai_microservice.ai_api:app --port 9000 --reload"

echo Avvio Frontend (React)...
start cmd /k "cd /d C:\Users\matte\PycharmProjects\cabina-app\frontend && npm start"

echo Tutto avviato.
pause
