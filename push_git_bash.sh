#!/bin/bash

cd "$(dirname "$0")"

echo "🔄 Eseguo git pull..."
git pull origin main || git pull origin master

echo "➕ Aggiungo modifiche..."
git add .

echo "🔍 Controllo modifiche da committare..."
if git diff-index --quiet HEAD --; then
  echo "⚠️  Nessuna modifica da committare."
else
  TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
  git commit -m "Aggiornamento automatico - $TIMESTAMP"
  echo "🚀 Eseguo push..."
  git push origin main || git push origin master
fi
