#!/usr/bin/env bash
# Inicia o n8n com as variáveis do Sentinela Sonar (Linux/macOS).  Uso: ./scripts/iniciar-n8n.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$RAIZ/.env" ] || { echo "Crie o arquivo .env a partir de .env.example"; exit 1; }
set -a; source "$RAIZ/.env"; set +a
export SONAR_DIR="$RAIZ"
export NODE_FUNCTION_ALLOW_BUILTIN="fs,path,crypto"
export N8N_BLOCK_ENV_ACCESS_IN_NODE="false"
export GENERIC_TIMEZONE="America/Sao_Paulo" TZ="America/Sao_Paulo"
export N8N_RUNNERS_ENABLED="false"
[ -f "$RAIZ/data/cadastros.json" ] || cp "$RAIZ/data/cadastros.exemplo.json" "$RAIZ/data/cadastros.json"
echo "SONAR_DIR=$SONAR_DIR"
npx --yes n8n@1
