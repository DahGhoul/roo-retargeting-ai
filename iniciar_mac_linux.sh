#!/usr/bin/env bash
set -e

echo "================================================================"
echo "  ROO RETARGETING AI - MAC / LINUX LAUNCHER (LEAD -> PAYER)"
echo "  Roo Retargeting AI · Agente Autonomo Omnicanal (LEAD -> PAYER)"
echo "================================================================"

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js no está instalado. Instálalo con: brew install node"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[1/2] Instalando dependencias (Baileys WhatsApp, Nodemailer, Express)..."
  npm install --no-audit --no-fund
fi

echo "[2/2] Iniciando servidor Roo Retargeting AI en http://localhost:4000 ..."
if command -v open >/dev/null 2>&1; then
  (sleep 2 && open "http://localhost:4000") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 2 && xdg-open "http://localhost:4000") &
fi

node server.js
