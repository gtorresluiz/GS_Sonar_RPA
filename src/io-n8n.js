// ---------------------------------------------------------------------
// Camada de I/O usada dentro dos nós Code do n8n (arquivos, logs, env).
// Requer: NODE_FUNCTION_ALLOW_BUILTIN=fs,path,crypto e
//         N8N_BLOCK_ENV_ACCESS_IN_NODE=false (ver README).
// ---------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const SONAR_DIR = $env.SONAR_DIR;
if (!SONAR_DIR) throw new Error('Variável de ambiente SONAR_DIR não definida. Inicie o n8n com scripts/iniciar-n8n.');
const DATA_DIR = path.join(SONAR_DIR, 'data');
const LOG_DIR = path.join(SONAR_DIR, 'logs');
const SAL = $env.SONAR_HASH_SALT || 'sonar';
const EXEC_ID = String($execution.id);

function lerJson(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, arquivo), 'utf8'));
  } catch (e) {
    if (padrao !== undefined) return padrao;
    throw e;
  }
}

// Escrita atômica: grava em .tmp e renomeia (evita arquivo corrompido pela metade).
function gravarJson(arquivo, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const destino = path.join(DATA_DIR, arquivo);
  fs.writeFileSync(destino + '.tmp', JSON.stringify(obj, null, 2));
  fs.renameSync(destino + '.tmp', destino);
}

// Log de auditoria em JSON Lines: um arquivo por dia, sem dados pessoais.
function log(nivel, evento, dados) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const agora = new Date();
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
  const linha = { ts: agora.toISOString(), execucao: EXEC_ID, nivel, evento, ...(dados || {}) };
  fs.appendFileSync(path.join(LOG_DIR, 'sentinela-' + dia + '.jsonl'), JSON.stringify(linha) + '\n');
}

function mensagemDeErro(err) {
  if (!err) return 'erro desconhecido';
  if (typeof err === 'string') return err;
  return err.message || err.description || JSON.stringify(err);
}
