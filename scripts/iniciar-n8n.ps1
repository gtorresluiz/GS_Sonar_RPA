# Inicia o n8n com as variáveis do Sentinela Sonar (Windows PowerShell).
# Uso, na raiz do repositório:  powershell -ExecutionPolicy Bypass -File scripts\iniciar-n8n.ps1
$raiz = (Resolve-Path "$PSScriptRoot\..").Path
$arqEnv = Join-Path $raiz ".env"
if (-not (Test-Path $arqEnv)) { Write-Error "Crie o arquivo .env a partir de .env.example"; exit 1 }
Get-Content $arqEnv | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"', "'"), 'Process')
  }
}
$env:SONAR_DIR = $raiz
$env:NODE_FUNCTION_ALLOW_BUILTIN = "fs,path,crypto"   # nós Code podem ler/gravar arquivos
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = "false"           # nós podem ler o token via $env (fora do código)
$env:GENERIC_TIMEZONE = "America/Sao_Paulo"
$env:TZ = "America/Sao_Paulo"
$env:N8N_RUNNERS_ENABLED = "false"                    # executa os nós Code no processo principal (mais simples)
if (-not (Test-Path (Join-Path $raiz "data\cadastros.json"))) {
  Copy-Item (Join-Path $raiz "data\cadastros.exemplo.json") (Join-Path $raiz "data\cadastros.json")
  Write-Host "data\cadastros.json criado a partir do exemplo. Edite com e-mails e paradas reais."
}
Write-Host "SONAR_DIR = $raiz"
npx --yes n8n@1
