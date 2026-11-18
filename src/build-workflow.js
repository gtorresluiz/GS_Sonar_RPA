// Gera n8n/sentinela-sonar.workflow.json embutindo o núcleo testado (sentinela-core.js)
// e a camada de I/O em cada nó Code. Rodar: node src/build-workflow.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raiz = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(__dirname, 'sentinela-core.js'), 'utf8').split('// @@EXPORTS@@')[0];
const io = fs.readFileSync(path.join(__dirname, 'io-n8n.js'), 'utf8');
const no = (arq) => fs.readFileSync(path.join(__dirname, 'nodes', arq), 'utf8');

// As constantes do núcleo e da camada de I/O precisam vir ANTES da lógica do nó.
const codigoOrdenado = (arq) => [
  '// ===== Gerado por src/build-workflow.js — edite os arquivos em src/ e rode o build =====',
  '// ===== Funções de apoio (src/sentinela-core.js e src/io-n8n.js) =====',
  core.trim(),
  io.trim(),
  '',
  '// ===================== LÓGICA DESTE NÓ (src/nodes/' + arq + ') =====================',
  no(arq).trim(),
].join('\n');

const uid = (s) => crypto.createHash('md5').update(s).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
const BASE = "{{ $env.OLHOVIVO_BASE_URL || 'http://api.olhovivo.sptrans.com.br/v2.1' }}";

const ifBool = (nome, expr, pos) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{
        id: uid(nome + 'cond'), leftValue: expr, rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      }],
      combinator: 'and',
    },
    options: {},
  },
  name: nome, type: 'n8n-nodes-base.if', typeVersion: 2, position: pos,
});

const codeNode = (nome, arq, pos, extra) => ({
  parameters: { ...(extra || {}), jsCode: codigoOrdenado(arq) },
  name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos,
});

const email = (nome, pos) => ({
  parameters: {
    fromEmail: '={{ $env.SONAR_EMAIL_FROM }}',
    toEmail: '={{ $json.email }}',
    subject: '={{ $json.assunto }}',
    emailFormat: 'text',
    text: '={{ $json.texto }}',
    options: { appendAttribution: false },
  },
  name: nome, type: 'n8n-nodes-base.emailSend', typeVersion: 2.1, position: pos,
  onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
});

const sticky = (nome, conteudo, pos, w, h, cor) => ({
  parameters: { content: conteudo, width: w, height: h, color: cor },
  name: nome, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: pos,
});

const nodes = [
  sticky('Nota: visão geral',
    '## Sentinela Sonar — RPA\nA cada minuto: lê os cadastros, consulta a previsão de chegada na API **Olho Vivo (SPTrans)** e decide se avisa o usuário por e-mail.\n\n**Regras:** janela de horário · ônibus acessível chegando · alerta quando o próximo NÃO é acessível · sem avisos repetidos.\n\nLogs: `logs/` · Saída para o MVP: `data/status_mvp.json`',
    [-40, -260], 520, 240, 4),
  sticky('Nota: exceções',
    '### Exceções\nLogin com 3 tentativas. Falha ou token recusado → log + status `api_disponivel=false` para o MVP + e-mail ao admin (máx. 1 a cada 30 min).',
    [900, 400], 560, 300, 3),

  { parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } },
    name: 'A cada 1 minuto', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 80] },
  { parameters: {}, name: 'Executar manualmente', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 260] },

  codeNode('Carregar cadastros', '01-carregar-cadastros.js', [240, 160]),

  { parameters: {
      method: 'POST',
      url: '=' + BASE + '/Login/Autenticar?token={{ $env.OLHOVIVO_TOKEN }}',
      options: { response: { response: { fullResponse: true } }, timeout: 10000 },
    },
    name: 'Autenticar Olho Vivo', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [480, 160],
    executeOnce: true, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueErrorOutput' },

  ifBool('Login OK?',
    "={{ String($json.body) === 'true' && [].concat(($json.headers || {})['set-cookie'] || []).length > 0 }}",
    [720, 100]),

  codeNode('Preparar consultas', '02-preparar-consultas.js', [960, 0]),

  { parameters: {
      url: '=' + BASE + '/Previsao/Parada?codigoParada={{ $json.codigo_parada }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Cookie', value: '={{ $json.cookie }}' }] },
      options: { timeout: 10000 },
    },
    name: 'Consultar previsão da parada', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1200, 0],
    retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput' },

  codeNode('Decidir notificações', '03-decidir-notificacoes.js', [1440, 0]),

  ifBool('Deve notificar?', '={{ $json.notificar }}', [1680, 0]),

  email('Enviar e-mail ao usuário', [1920, -100]),
  codeNode('Registrar envio', '04-registrar-envio.js', [2160, -100], { mode: 'runOnceForEachItem' }),
  { parameters: {}, name: 'Sem notificação', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [1920, 120] },

  codeNode('Registrar falha da API', '05-registrar-falha-api.js', [960, 520]),
  email('Alertar administrador', [1220, 520]),
].map((n) => ({ id: uid(n.name), ...n }));

const liga = (destino, idx = 0) => ({ node: destino, type: 'main', index: idx });
const connections = {
  'A cada 1 minuto': { main: [[liga('Carregar cadastros')]] },
  'Executar manualmente': { main: [[liga('Carregar cadastros')]] },
  'Carregar cadastros': { main: [[liga('Autenticar Olho Vivo')]] },
  'Autenticar Olho Vivo': { main: [[liga('Login OK?')], [liga('Registrar falha da API')]] },
  'Login OK?': { main: [[liga('Preparar consultas')], [liga('Registrar falha da API')]] },
  'Preparar consultas': { main: [[liga('Consultar previsão da parada')]] },
  'Consultar previsão da parada': { main: [[liga('Decidir notificações')]] },
  'Decidir notificações': { main: [[liga('Deve notificar?')]] },
  'Deve notificar?': { main: [[liga('Enviar e-mail ao usuário')], [liga('Sem notificação')]] },
  'Enviar e-mail ao usuário': { main: [[liga('Registrar envio')]] },
  'Registrar falha da API': { main: [[liga('Alertar administrador')]] },
};

const workflow = {
  name: 'Sentinela Sonar — avisos de ônibus acessível (Olho Vivo)',
  nodes,
  connections,
  pinData: {},
  settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveManualExecutions: true },
  active: false,
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const destino = path.join(raiz, 'n8n', 'sentinela-sonar.workflow.json');
fs.writeFileSync(destino, JSON.stringify(workflow, null, 2));
console.log('Workflow gerado em', path.relative(raiz, destino), '-', nodes.length, 'nós');
