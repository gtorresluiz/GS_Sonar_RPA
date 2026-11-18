// Testes das regras de negócio do Sentinela Sonar.
// Rodar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const core = require('../src/sentinela-core');

const fx = (n) => require(path.join(__dirname, 'fixtures', n));
const AGORA = Date.parse('2026-11-18T10:30:00Z'); // 07:30 em São Paulo, quarta-feira

const cadastroBase = () => core.validarCadastro({
  id: 'c-001', email: 'usuario.teste@example.com', codigo_parada: 340015329, linha: '8000-10',
  sentido: 1, limiar_min: 8, janela: { inicio: '07:00', fim: '09:00', dias: ['seg', 'ter', 'qua', 'qui', 'sex'] },
}).cadastro;

// ------------------------------------------------------------- SUCESSO
test('sucesso: ônibus acessível dentro do limiar gera aviso de chegada', () => {
  const r = core.avaliarCadastro(cadastroBase(), fx('previsao_acessivel_chegando.json'), {}, AGORA);
  assert.equal(r.status, 'notificar_chegada');
  assert.equal(r.notificar, true);
  assert.equal(r.proximo_acessivel_min, 4);
  assert.match(r.assunto, /8000-10 acessível chega em 4 minutos/);
  assert.match(r.texto, /prefixo 11434/);
});

// ------------------------------------------------------------- DECISÃO
test('decisão: próximo NÃO acessível vem antes → aviso de chegada inclui alerta', () => {
  const r = core.avaliarCadastro(cadastroBase(), fx('previsao_nao_acessivel_primeiro.json'), {}, AGORA);
  assert.equal(r.status, 'notificar_chegada');
  assert.match(r.texto, /sem acessibilidade, em cerca de 3 minutos, prefixo 11433/);
});

test('decisão: só há ônibus não acessíveis → alerta "não acessível" sem alternativa', () => {
  const r = core.avaliarCadastro(cadastroBase(), fx('previsao_so_nao_acessiveis.json'), {}, AGORA);
  assert.equal(r.status, 'notificar_nao_acessivel');
  assert.match(r.texto, /Não há ônibus acessível/);
});

test('decisão: usuário que aceita qualquer ônibus não recebe alerta "não acessível"', () => {
  const c = { ...cadastroBase(), somente_acessivel: false };
  const r = core.avaliarCadastro(c, fx('previsao_so_nao_acessiveis.json'), {}, AGORA);
  assert.equal(r.status, 'aguardando');
});

test('decisão: ônibus longe do limiar → aguardando, sem envio', () => {
  const r = core.avaliarCadastro(cadastroBase(), fx('previsao_longe.json'), {}, AGORA);
  assert.equal(r.status, 'aguardando');
  assert.equal(r.notificar, false);
});

test('decisão: mesmo aviso não é reenviado (deduplicação por 90 min)', () => {
  const c = cadastroBase();
  const r1 = core.avaliarCadastro(c, fx('previsao_acessivel_chegando.json'), {}, AGORA);
  const estado = { enviados: { [r1.chave]: AGORA - 60 * 1000 } };
  const r2 = core.avaliarCadastro(c, fx('previsao_acessivel_chegando.json'), estado, AGORA);
  assert.equal(r2.status, 'ja_notificado');
  assert.equal(r2.notificar, false);
});

test('decisão: alerta "não acessível" respeita cooldown de 15 min por cadastro', () => {
  const c = cadastroBase();
  const estado = { enviados: { 'c-001|8000-10|nao_acessivel|99999': AGORA - 5 * 60 * 1000 } };
  const r = core.avaliarCadastro(c, fx('previsao_so_nao_acessiveis.json'), estado, AGORA);
  assert.equal(r.status, 'ja_notificado');
});

test('decisão: janela de horário e dia da semana', () => {
  const c = cadastroBase();
  assert.equal(core.dentroDaJanela(c, { diaSemana: 3, minutos: 7 * 60 + 30 }), true);  // qua 07:30
  assert.equal(core.dentroDaJanela(c, { diaSemana: 3, minutos: 10 * 60 }), false);     // qua 10:00
  assert.equal(core.dentroDaJanela(c, { diaSemana: 0, minutos: 7 * 60 + 30 }), false); // dom
  const noturno = { ...c, janela: { inicio: '22:00', fim: '01:00', dias: [5] } };      // sex 22h–01h
  assert.equal(core.dentroDaJanela(noturno, { diaSemana: 6, minutos: 30 }), true);      // sáb 00:30
});

test('decisão: previsão que atravessa a meia-noite', () => {
  assert.equal(core.minutosAte('23:58', '00:03'), 5);
  const r = core.avaliarCadastro({ ...cadastroBase(), janela: { inicio: '00:00', fim: '23:59', dias: [3] } },
    fx('previsao_virada_meia_noite.json'), {}, AGORA);
  assert.equal(r.proximo_acessivel_min, 5);
});

// ------------------------------------------------------------- FALHAS
test('falha: API retornou erro → erro_consulta, sem envio', () => {
  const r = core.avaliarCadastro(cadastroBase(), { error: { message: 'ECONNREFUSED' } }, {}, AGORA);
  assert.equal(r.status, 'erro_consulta');
  assert.equal(r.notificar, false);
});

test('falha: parada sem previsão (p = null)', () => {
  const r = core.avaliarCadastro(cadastroBase(), fx('previsao_sem_dados.json'), {}, AGORA);
  assert.equal(r.status, 'sem_previsao');
});

test('falha: resposta sem campo hr → resposta_inconsistente', () => {
  const r = core.avaliarCadastro(cadastroBase(), { p: null }, {}, AGORA);
  assert.equal(r.status, 'resposta_inconsistente');
});

test('falha: veículos com horário inválido e duplicados são descartados', () => {
  const r = core.resumirLinha(fx('previsao_inconsistente.json'), '8000-10', 1);
  assert.equal(r.status, 'ok');
  assert.equal(r.veiculos.length, 1);
});

test('falha: cadastros inválidos e duplicados são separados com motivo', () => {
  const { validos, invalidos, duplicados } = core.validarCadastros([
    { id: 'c-001', email: 'a@b.com', codigo_parada: 1, linha: '8000-10' },
    { id: 'c-001', email: 'a@b.com', codigo_parada: 1, linha: '8000-10' },   // duplicado
    { id: 'c-002', email: 'sem-arroba', codigo_parada: 1, linha: '8000-10' },
    { id: 'c-003', email: 'a@b.com', codigo_parada: 'abc', linha: '8000-10' },
    { id: 'c-004', email: 'a@b.com', codigo_parada: 1, linha: 'oito mil' },
    { id: 'c-005', email: 'a@b.com', codigo_parada: 1, linha: '8000-10', limiar_min: 500 },
    null,
  ]);
  assert.equal(validos.length, 1);
  assert.equal(duplicados, 1);
  assert.deepEqual(invalidos.map((i) => i.motivo), [
    'e-mail inválido', 'codigo_parada inválido', 'linha inválida (use o letreiro, ex.: 8000-10)',
    'limiar_min fora de 1–60', 'registro não é um objeto',
  ]);
});

// ------------------------------------------------------------- LGPD / segurança
test('LGPD: hash do usuário é estável e não revela o id; e-mail mascarado', () => {
  assert.equal(core.hashUsuario('c-001', 's'), core.hashUsuario('c-001', 's'));
  assert.notEqual(core.hashUsuario('c-001', 's'), 'c-001');
  assert.equal(core.mascararEmail('gabriel@example.com'), 'ga***@example.com');
});

test('segurança: sanitizar remove token, cookie e e-mails de mensagens de erro', () => {
  const s = core.sanitizar('falha em /Login/Autenticar?token=abc123 cookie apiCredentials=XYZ; user joao@x.com');
  assert.doesNotMatch(s, /abc123|XYZ|joao@/);
});

// ------------------------------------------------------------- integração MVP
test('MVP: status estruturado por parada/linha', () => {
  const c = cadastroBase();
  const s = core.montarStatusMVP([c, { ...c, id: 'c-009' }], { 340015329: fx('previsao_nao_acessivel_primeiro.json') },
    '2026-11-18T10:30:00.000Z');
  assert.equal(s.paradas.length, 1);
  assert.equal(s.paradas[0].linhas.length, 1); // dois usuários, mesma linha → uma entrada
  assert.deepEqual(s.paradas[0].linhas[0].proximo, { minutos: 3, acessivel: false });
  assert.equal(s.paradas[0].linhas[0].pct_acessiveis, 50);
});
