// Simulação de ponta a ponta: executa o código REAL dos nós Code do workflow exportado,
// imitando o runtime do n8n ($env, $execution, $input, $(), $json) e a API Olho Vivo.
// Gera tests/RESULTADOS.md e amostras de log em logs/amostras/.
// Rodar: node tests/simular-n8n.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = path.join(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(raiz, 'n8n', 'sentinela-sonar.workflow.json'), 'utf8'));
const codigoDe = (nome) => wf.nodes.find((n) => n.name === nome).parameters.jsCode;
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));

let execSeq = 1000;

function rodarNo(nome, { env, input, saidas, porItem }) {
  const code = codigoDe(nome);
  const fn = new Function('$env', '$execution', '$input', '$', '$json', 'require', code);
  const execucao = { id: String(execSeq) };
  const $ = (outro) => ({
    all: () => saidas[outro] || [],
    first: () => (saidas[outro] || [])[0],
    get item() { return saidas.__pareado[outro]; },
  });
  if (!porItem) {
    const $input = { all: () => input, first: () => input[0] };
    return fn(env, execucao, $input, $, input[0] && input[0].json, require) || [];
  }
  return input.map((it, i) => {
    saidas.__pareado = { 'Decidir notificações': it.__origem };
    return fn(env, execucao, { item: it }, $, it.json, require);
  });
}

// Executa o fluxo inteiro como o n8n faria, com API e SMTP simulados.
function executarFluxo(env, { login, previsao, emailFalha }) {
  execSeq++;
  const saidas = { __pareado: {} };
  const trilha = [];
  try {
    saidas['Carregar cadastros'] = rodarNo('Carregar cadastros', { env, input: [{ json: {} }], saidas });
  } catch (e) {
    trilha.push('Carregar cadastros → ERRO: ' + e.message);
    return trilha;
  }
  trilha.push('Carregar cadastros → ' + saidas['Carregar cadastros'].length + ' cadastro(s) na janela');
  if (!saidas['Carregar cadastros'].length) return trilha;

  // HTTP "Autenticar Olho Vivo" (executeOnce, 3 tentativas, saída de erro)
  const loginItem = login();
  const loginOk = !loginItem.error && String(loginItem.body) === 'true'
    && [].concat((loginItem.headers || {})['set-cookie'] || []).length > 0;
  if (!loginOk) {
    trilha.push('Autenticar/Login OK? → falha (' + (loginItem.error ? 'erro HTTP' : 'login recusado') + ')');
    const alerta = rodarNo('Registrar falha da API', { env, input: [{ json: loginItem }], saidas });
    trilha.push('Registrar falha da API → ' + (alerta.length ? 'alerta ao admin: "' + alerta[0].json.assunto + '"' : 'alerta ao admin suprimido'));
    return trilha;
  }
  trilha.push('Autenticar/Login OK? → sim');
  saidas['Autenticar Olho Vivo'] = [{ json: loginItem }];
  saidas['Preparar consultas'] = rodarNo('Preparar consultas', { env, input: saidas['Autenticar Olho Vivo'], saidas });
  trilha.push('Preparar consultas → ' + saidas['Preparar consultas'].length + ' parada(s) a consultar');

  const respostas = saidas['Preparar consultas'].map((it) => ({ json: previsao(it.json.codigo_parada, it.json.cookie) }));
  saidas['Decidir notificações'] = rodarNo('Decidir notificações', { env, input: respostas, saidas });
  const decisoes = saidas['Decidir notificações'];
  trilha.push('Decidir notificações → ' + decisoes.map((d) => d.json.cadastro_id + ':' + d.json.status).join(', '));

  const notificar = decisoes.filter((d) => d.json.notificar === true);
  if (!notificar.length) { trilha.push('Deve notificar? → não (Sem notificação)'); return trilha; }
  const enviados = notificar.map((d) => ({
    json: emailFalha ? { error: { message: 'SMTP 535 autenticação falhou para joao@exemplo.com' } } : { accepted: [d.json.email] },
    __origem: d,
  }));
  notificar.forEach((d) => trilha.push('Enviar e-mail → assunto: "' + d.json.assunto + '"'));
  const reg = rodarNo('Registrar envio', { env, input: enviados, saidas, porItem: true });
  trilha.push('Registrar envio → ' + reg.map((r) => (r.json.enviado ? 'enviado' : 'FALHOU')).join(', '));
  return trilha;
}

// --------------------------------------------------------------- cenários
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonar-'));
fs.mkdirSync(path.join(tmp, 'data'));
const env = { SONAR_DIR: tmp, SONAR_ADMIN_EMAIL: 'admin@exemplo.com', SONAR_HASH_SALT: 'teste' };
const salvarCadastros = (l) => fs.writeFileSync(path.join(tmp, 'data', 'cadastros.json'), JSON.stringify(l, null, 2));
const todaHora = { inicio: '00:00', fim: '23:59' };

const loginOk = () => ({ body: true, headers: { 'set-cookie': ['apiCredentials=SEGREDO123; path=/; HttpOnly'] }, statusCode: 200 });
const loginRecusado = () => ({ body: false, headers: {}, statusCode: 200 });
const apiFora = () => ({ error: { message: 'getaddrinfo ENOTFOUND api.olhovivo.sptrans.com.br (token=f7498b7b...)' } });

const PARADA_A = 340015329; const PARADA_B = 260016859;
const cadastrosDemo = [
  { id: 'c-001', email: 'ana@exemplo.com', codigo_parada: PARADA_A, linha: '8000-10', sentido: 1, limiar_min: 8, janela: todaHora },
  { id: 'c-002', email: 'bruno@exemplo.com', codigo_parada: PARADA_B, linha: '8000-10', sentido: 1, limiar_min: 8, janela: todaHora },
  { id: 'c-003', email: 'carla@exemplo.com', codigo_parada: PARADA_A, linha: '8000-10', sentido: 1, limiar_min: 2, janela: todaHora },
  { id: 'c-001', email: 'ana@exemplo.com', codigo_parada: PARADA_A, linha: '8000-10', sentido: 1, limiar_min: 8, janela: todaHora }, // duplicado
  { id: 'c-004', email: 'email-invalido', codigo_parada: PARADA_A, linha: '8000-10' },                                             // inválido
  { id: 'c-005', email: 'dani@exemplo.com', codigo_parada: PARADA_A, linha: '8000-10', janela: { inicio: '03:00', fim: '03:01', dias: ['dom'] } }, // fora da janela (quase sempre)
];
const previsaoPorParada = (cp) => (cp === PARADA_A ? fx('previsao_nao_acessivel_primeiro.json') : fx('previsao_so_nao_acessiveis.json'));

const cenarios = [
  ['S1', 'Sucesso', 'Fluxo completo: login, consulta, decisão e envio de e-mails', () => {
    salvarCadastros(cadastrosDemo);
    return executarFluxo(env, { login: loginOk, previsao: previsaoPorParada });
  }],
  ['D1', 'Decisão', 'Segunda execução no mesmo minuto: avisos já enviados não se repetem', () =>
    executarFluxo(env, { login: loginOk, previsao: previsaoPorParada })],
  ['D2', 'Decisão', 'Ônibus longe do limiar: nenhuma notificação', () => {
    fs.writeFileSync(path.join(tmp, 'data', 'estado.json'), '{}');
    return executarFluxo(env, { login: loginOk, previsao: () => fx('previsao_longe.json') });
  }],
  ['F1', 'Falha', 'API fora do ar (DNS/timeout) após as tentativas', () =>
    executarFluxo(env, { login: apiFora, previsao: previsaoPorParada })],
  ['F2', 'Falha', 'Token recusado pela API, com alerta ao admin suprimido (já alertado há menos de 30 min)', () =>
    executarFluxo(env, { login: loginRecusado, previsao: previsaoPorParada })],
  ['F3', 'Falha', 'Consulta de uma parada falha; a outra segue normalmente', () => {
    fs.writeFileSync(path.join(tmp, 'data', 'estado.json'), '{}');
    return executarFluxo(env, { login: loginOk, previsao: (cp) => (cp === PARADA_A ? { error: { message: 'timeout of 10000ms exceeded' } } : fx('previsao_so_nao_acessiveis.json')) });
  }],
  ['F4', 'Falha', 'SMTP recusa o envio: aviso NÃO é marcado como enviado (nova tentativa no próximo ciclo)', () => {
    fs.writeFileSync(path.join(tmp, 'data', 'estado.json'), '{}');
    return executarFluxo(env, { login: loginOk, previsao: previsaoPorParada, emailFalha: true });
  }],
  ['F5', 'Falha', 'Arquivo de cadastros corrompido: execução falha de forma explícita', () => {
    fs.writeFileSync(path.join(tmp, 'data', 'cadastros.json'), '{ isto não é json');
    return executarFluxo(env, { login: loginOk, previsao: previsaoPorParada });
  }],
];

let md = '# Resultados dos testes de ponta a ponta (simulação do n8n)\n\n'
  + 'Gerado por `node tests/simular-n8n.js` em ' + new Date().toISOString() + '.\n'
  + 'O código executado é o mesmo exportado em `n8n/sentinela-sonar.workflow.json`; a API Olho Vivo e o SMTP são simulados.\n\n'
  + '| ID | Tipo | Cenário | Caminho percorrido no fluxo |\n|---|---|---|---|\n';
for (const [id, tipo, desc, fn] of cenarios) {
  const trilha = fn();
  md += '| ' + id + ' | ' + tipo + ' | ' + desc + ' | ' + trilha.join('<br>').replace(/\|/g, '\\|') + ' |\n';
  console.log('\n[' + id + '] ' + desc + '\n  ' + trilha.join('\n  '));
}

// Copia evidências
const logs = fs.readdirSync(path.join(tmp, 'logs'));
const dirAmostras = path.join(raiz, 'logs', 'amostras');
fs.mkdirSync(dirAmostras, { recursive: true });
for (const l of logs) fs.copyFileSync(path.join(tmp, 'logs', l), path.join(dirAmostras, 'simulacao-' + l));
const status = fs.readFileSync(path.join(tmp, 'data', 'status_mvp.json'), 'utf8');
fs.writeFileSync(path.join(dirAmostras, 'status_mvp-exemplo.json'), status);

const logTxt = logs.map((l) => fs.readFileSync(path.join(tmp, 'logs', l), 'utf8')).join('');
const vazou = /SEGREDO123|f7498b7b|ana@exemplo|bruno@exemplo|joao@exemplo|carla@exemplo/.test(logTxt);
md += '\n## Verificação de dados sensíveis nos logs\n\n'
  + (vazou ? '**FALHOU**: dado sensível encontrado no log.\n' : 'Nenhum token, cookie ou e-mail completo foi encontrado nos logs gerados (verificação automática).\n');
md += '\nAmostras: `logs/amostras/`.\n';
fs.writeFileSync(path.join(__dirname, 'RESULTADOS.md'), md);
console.log('\nVazamento de dado sensível nos logs:', vazou ? 'SIM (corrigir!)' : 'não');
if (vazou) process.exit(1);
