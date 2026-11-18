// =====================================================================
// Sentinela Sonar — núcleo de regras de negócio (puro, sem I/O)
// Este arquivo é testado com `node --test` e embutido nos nós Code do
// n8n pelo script src/build-workflow.js. Não use require() de módulos
// externos aqui: apenas 'crypto' (builtin liberado no n8n).
// =====================================================================

const TZ = 'America/Sao_Paulo';
const TTL_DEDUP_MS = 90 * 60 * 1000;          // não repete o mesmo aviso por 90 min
const COOLDOWN_NAO_ACESSIVEL_MS = 15 * 60 * 1000; // no máx. 1 alerta "não acessível" a cada 15 min por cadastro
const LIMIAR_PADRAO_MIN = 10;

const DIAS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_LINHA = /^[A-Z0-9]{3,5}-\d{2}$/i;   // letreiro SPTrans, ex.: 8000-10, N101-11
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------- utilidades
function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function agoraEmSaoPaulo(data) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(data || new Date());
  const get = (t) => partes.find((p) => p.type === t).value;
  const mapaDia = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hora = Number(get('hour')) % 24;
  return { diaSemana: mapaDia[get('weekday')], minutos: hora * 60 + Number(get('minute')) };
}

// Minutos entre o horário da API ("hr") e a previsão do veículo ("t"), ambos HH:MM.
function minutosAte(hrApi, tVeiculo) {
  const diff = (paraMinutos(tVeiculo) - paraMinutos(hrApi) + 1440) % 1440;
  return diff > 720 ? 0 : diff; // previsão "no passado" = está chegando
}

function hashUsuario(id, sal) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(sal || 'sonar') + ':' + String(id)).digest('hex').slice(0, 12);
}

function mascararEmail(email) {
  const [u, d] = String(email).split('@');
  if (!d) return '***';
  return u.slice(0, 2) + '***@' + d;
}

function textoMinutos(min) {
  if (min <= 0) return 'menos de 1 minuto';
  if (min === 1) return '1 minuto';
  return min + ' minutos';
}

// -------------------------------------------------- validação de cadastros
function normalizarDias(dias) {
  if (dias === undefined || dias === null) return [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(dias) || dias.length === 0) return null;
  const out = [];
  for (const d of dias) {
    const v = typeof d === 'number' ? d : DIAS[String(d).toLowerCase().slice(0, 3)];
    if (!Number.isInteger(v) || v < 0 || v > 6) return null;
    out.push(v);
  }
  return [...new Set(out)];
}

function validarCadastro(c) {
  if (!c || typeof c !== 'object') return { erro: 'registro não é um objeto' };
  if (!c.id || typeof c.id !== 'string') return { erro: 'id ausente' };
  if (!RE_EMAIL.test(String(c.email || ''))) return { erro: 'e-mail inválido' };
  const parada = Number(c.codigo_parada);
  if (!Number.isInteger(parada) || parada <= 0) return { erro: 'codigo_parada inválido' };
  if (!RE_LINHA.test(String(c.linha || ''))) return { erro: 'linha inválida (use o letreiro, ex.: 8000-10)' };
  const sentido = c.sentido === undefined || c.sentido === null ? null : Number(c.sentido);
  if (sentido !== null && sentido !== 1 && sentido !== 2) return { erro: 'sentido deve ser 1 ou 2' };
  const limiar = c.limiar_min === undefined ? LIMIAR_PADRAO_MIN : Number(c.limiar_min);
  if (!Number.isFinite(limiar) || limiar < 1 || limiar > 60) return { erro: 'limiar_min fora de 1–60' };
  const janela = c.janela || {};
  const inicio = janela.inicio || '00:00';
  const fim = janela.fim || '23:59';
  if (!RE_HORA.test(inicio) || !RE_HORA.test(fim)) return { erro: 'janela com horário inválido (HH:MM)' };
  const dias = normalizarDias(janela.dias);
  if (!dias) return { erro: 'janela.dias inválido' };
  return {
    cadastro: {
      id: c.id,
      email: String(c.email).trim(),
      codigo_parada: parada,
      linha: String(c.linha).toUpperCase(),
      sentido,
      limiar_min: limiar,
      somente_acessivel: c.somente_acessivel !== false,
      ativo: c.ativo !== false,
      janela: { inicio, fim, dias },
    },
  };
}

// Valida a lista inteira, remove duplicados (mesmo usuário + parada + linha + sentido).
function validarCadastros(lista) {
  const validos = [];
  const invalidos = [];
  const vistos = new Set();
  let duplicados = 0;
  (lista || []).forEach((c, indice) => {
    const r = validarCadastro(c);
    if (r.erro) { invalidos.push({ indice, motivo: r.erro }); return; }
    const k = [r.cadastro.id, r.cadastro.codigo_parada, r.cadastro.linha, r.cadastro.sentido].join('|');
    if (vistos.has(k)) { duplicados++; return; }
    vistos.add(k);
    validos.push(r.cadastro);
  });
  return { validos, invalidos, duplicados };
}

function dentroDaJanela(cadastro, agoraSP) {
  const { inicio, fim, dias } = cadastro.janela;
  const ini = paraMinutos(inicio);
  const f = paraMinutos(fim);
  if (ini <= f) {
    return dias.includes(agoraSP.diaSemana) && agoraSP.minutos >= ini && agoraSP.minutos <= f;
  }
  // janela que atravessa a meia-noite (ex.: 22:00–01:00)
  if (agoraSP.minutos >= ini) return dias.includes(agoraSP.diaSemana);
  if (agoraSP.minutos <= f) return dias.includes((agoraSP.diaSemana + 6) % 7);
  return false;
}

// ------------------------------------------------ leitura da previsão (API)
// previsao = resposta de GET /Previsao/Parada?codigoParada=X
// { hr: "HH:MM", p: { cp, np, l: [ { c, cl, sl, lt0, lt1, vs: [ { p, t, a } ] } ] } }
function resumirLinha(previsao, linha, sentido) {
  if (!previsao || previsao.error) return { status: 'erro_consulta' };
  if (!previsao.hr || !RE_HORA.test(previsao.hr)) return { status: 'resposta_inconsistente' };
  if (!previsao.p || !Array.isArray(previsao.p.l)) return { status: 'sem_previsao' };
  const linhas = previsao.p.l.filter((l) =>
    String(l.c).toUpperCase() === linha && (sentido === null || sentido === undefined || Number(l.sl) === sentido));
  const vistos = new Set();
  const veiculos = [];
  for (const l of linhas) {
    for (const v of l.vs || []) {
      if (!v || !v.t || !RE_HORA.test(v.t)) continue;           // dado inconsistente: ignora
      const prefixo = String(v.p);
      if (vistos.has(prefixo)) continue;                          // veículo duplicado na resposta
      vistos.add(prefixo);
      veiculos.push({
        prefixo,
        minutos: minutosAte(previsao.hr, v.t),
        acessivel: v.a === true,
        destino: l.lt0, // letreiro de destino (doc. SPTrans)
      });
    }
  }
  if (!veiculos.length) return { status: 'linha_sem_previsao', nomeParada: previsao.p.np };
  veiculos.sort((a, b) => a.minutos - b.minutos);
  const acessiveis = veiculos.filter((v) => v.acessivel);
  return {
    status: 'ok',
    nomeParada: previsao.p.np,
    hrApi: previsao.hr,
    veiculos,
    proximo: veiculos[0],
    proximoAcessivel: acessiveis[0] || null,
    pctAcessiveis: Math.round((acessiveis.length / veiculos.length) * 100),
  };
}

// --------------------------------------------------------- regra de decisão
function jaEnviado(estado, chave, agoraMs) {
  const t = estado && estado.enviados && estado.enviados[chave];
  return Boolean(t && agoraMs - t < TTL_DEDUP_MS);
}

function emCooldown(estado, prefixoChave, agoraMs) {
  const env = (estado && estado.enviados) || {};
  return Object.keys(env).some((k) => k.startsWith(prefixoChave) && agoraMs - env[k] < COOLDOWN_NAO_ACESSIVEL_MS);
}

function avaliarCadastro(cadastro, previsao, estado, agoraMs, sal) {
  const base = {
    cadastro_id: cadastro.id,
    usuario_hash: hashUsuario(cadastro.id, sal),
    linha: cadastro.linha,
    codigo_parada: cadastro.codigo_parada,
    notificar: false,
  };
  const r = resumirLinha(previsao, cadastro.linha, cadastro.sentido);
  if (r.status !== 'ok') return { ...base, status: r.status };

  const { proximo, proximoAcessivel } = r;
  const local = r.nomeParada ? 'no ponto ' + r.nomeParada : 'no seu ponto';
  const destino = (v) => (v.destino ? ', sentido ' + v.destino : '');
  const resumo = {
    proximo_min: proximo.minutos,
    proximo_acessivel: proximo.acessivel,
    proximo_acessivel_min: proximoAcessivel ? proximoAcessivel.minutos : null,
  };

  // Regra 1 — ônibus acessível dentro do limiar → avisa que está chegando
  if (proximoAcessivel && proximoAcessivel.minutos <= cadastro.limiar_min) {
    const chave = cadastro.id + '|' + cadastro.linha + '|chegando|' + proximoAcessivel.prefixo;
    if (jaEnviado(estado, chave, agoraMs)) return { ...base, ...resumo, status: 'ja_notificado', chave };
    let texto = 'Seu ônibus está chegando.\n'
      + 'Linha ' + cadastro.linha + destino(proximoAcessivel) + '.\n'
      + 'Chega em cerca de ' + textoMinutos(proximoAcessivel.minutos) + ' ' + local + '.\n'
      + 'Veículo acessível, prefixo ' + proximoAcessivel.prefixo + '.';
    if (!proximo.acessivel && proximo.prefixo !== proximoAcessivel.prefixo) {
      texto += '\nAtenção: antes dele passa um ônibus da mesma linha sem acessibilidade, em cerca de '
        + textoMinutos(proximo.minutos) + ', prefixo ' + proximo.prefixo + '.';
    }
    return {
      ...base, ...resumo, status: 'notificar_chegada', notificar: true, chave,
      email: cadastro.email,
      assunto: 'Sonar: ' + cadastro.linha + ' acessível chega em ' + textoMinutos(proximoAcessivel.minutos),
      texto: texto + rodape(),
    };
  }

  // Regra 2 — próximo ônibus está perto, mas NÃO é acessível → alerta
  if (cadastro.somente_acessivel && !proximo.acessivel && proximo.minutos <= cadastro.limiar_min) {
    const prefixoCooldown = cadastro.id + '|' + cadastro.linha + '|nao_acessivel|';
    const chave = prefixoCooldown + proximo.prefixo;
    if (jaEnviado(estado, chave, agoraMs) || emCooldown(estado, prefixoCooldown, agoraMs)) {
      return { ...base, ...resumo, status: 'ja_notificado', chave };
    }
    const alternativa = proximoAcessivel
      ? 'O próximo ônibus acessível dessa linha chega em cerca de ' + textoMinutos(proximoAcessivel.minutos) + '.'
      : 'Não há ônibus acessível dessa linha na previsão atual. Se puder, aguarde ou considere outra rota.';
    return {
      ...base, ...resumo, status: 'notificar_nao_acessivel', notificar: true, chave,
      email: cadastro.email,
      assunto: 'Sonar: próximo ' + cadastro.linha + ' não é acessível',
      texto: 'O próximo ônibus da linha ' + cadastro.linha + destino(proximo) + ' chega em cerca de '
        + textoMinutos(proximo.minutos) + ' ' + local + ', mas não é acessível (prefixo ' + proximo.prefixo + ').\n'
        + alternativa + rodape(),
    };
  }

  // Regra 3 — nada perto o suficiente
  return { ...base, ...resumo, status: 'aguardando' };
}

function rodape() {
  return '\n\nMensagem automática do Sonar. Os horários são previsões da SPTrans e podem mudar.';
}

// Processa todos os cadastros de uma execução (laço principal).
function processarExecucao(cadastros, previsoesPorParada, estado, agoraMs, sal) {
  const resultados = [];
  for (const c of cadastros) {
    resultados.push(avaliarCadastro(c, previsoesPorParada[c.codigo_parada], estado, agoraMs, sal));
  }
  return resultados;
}

// Saída estruturada consumida pelo MVP (contrato em docs/contrato-saida-mvp.md).
function montarStatusMVP(cadastros, previsoesPorParada, agoraIso) {
  const pares = new Map();
  for (const c of cadastros) pares.set(c.codigo_parada + '|' + c.linha + '|' + c.sentido, c);
  const paradas = {};
  for (const c of pares.values()) {
    const r = resumirLinha(previsoesPorParada[c.codigo_parada], c.linha, c.sentido);
    const p = (paradas[c.codigo_parada] = paradas[c.codigo_parada] || {
      codigo_parada: c.codigo_parada, nome: r.nomeParada || null, linhas: [],
    });
    if (!p.nome && r.nomeParada) p.nome = r.nomeParada;
    p.linhas.push(r.status === 'ok' ? {
      linha: c.linha,
      sentido: c.sentido,
      status: 'ok',
      proximo: { minutos: r.proximo.minutos, acessivel: r.proximo.acessivel },
      proximo_acessivel: r.proximoAcessivel ? { minutos: r.proximoAcessivel.minutos } : null,
      veiculos_previstos: r.veiculos.length,
      pct_acessiveis: r.pctAcessiveis,
    } : { linha: c.linha, sentido: c.sentido, status: r.status });
  }
  return { versao: 1, gerado_em: agoraIso, api_disponivel: true, paradas: Object.values(paradas) };
}

function limparEstado(estado, agoraMs) {
  const novo = { enviados: {}, ultimo_alerta_admin: (estado && estado.ultimo_alerta_admin) || 0 };
  const env = (estado && estado.enviados) || {};
  for (const k of Object.keys(env)) if (agoraMs - env[k] < TTL_DEDUP_MS) novo.enviados[k] = env[k];
  return novo;
}

// Remove segredos de mensagens de erro antes de registrar em log.
function sanitizar(msg) {
  return String(msg || '')
    .replace(/token=[^&\s"']+/gi, 'token=***')
    .replace(/apiCredentials=[^;\s"']+/gi, 'apiCredentials=***')
    .replace(/[^\s@"']+@[^\s@"']+\.[^\s@"']+/g, (e) => mascararEmail(e))
    .slice(0, 300);
}

// @@EXPORTS@@ (removido no build do n8n)
module.exports = {
  agoraEmSaoPaulo, minutosAte, hashUsuario, mascararEmail, validarCadastros, validarCadastro,
  dentroDaJanela, resumirLinha, avaliarCadastro, processarExecucao, montarStatusMVP, limparEstado,
  sanitizar, TTL_DEDUP_MS, COOLDOWN_NAO_ACESSIVEL_MS,
};
