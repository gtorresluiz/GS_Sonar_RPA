// Simulador local da API Olho Vivo v2.1 (mesmos endpoints e formato de resposta).
// Usado para demonstração e testes enquanto a chave da SPTrans não é liberada.
//   node src/mock-olhovivo.js            → http://localhost:3001/v2.1
//   no .env: OLHOVIVO_BASE_URL=http://localhost:3001/v2.1
// Cenários (variável MOCK_CENARIO): normal (padrão) | fora (API devolve 503)
const http = require('http');

const PORTA = Number(process.env.MOCK_PORT || 3001);
const CENARIO = process.env.MOCK_CENARIO || 'normal';
const COOKIE = 'apiCredentials=MOCK-SESSAO';

const PARADAS = [
  { cp: 340015329, np: 'PARADA PAULISTA - MASP', ed: 'AV PAULISTA, 1578', py: -23.5614, px: -46.6559 },
  { cp: 260016859, np: 'PARADA CONSOLACAO', ed: 'R DA CONSOLACAO, 2300', py: -23.5532, px: -46.6601 },
];

// Frota simulada: minutos a partir de agora, prefixo e acessibilidade.
// O ciclo de 20 min faz os ônibus "andarem" e as previsões mudarem a cada minuto.
const FROTA = {
  '8000-10': { cl: 1273, sl: 1, lt0: 'PCA. RAMOS DE AZEVEDO', lt1: 'TERM. LAPA',
    vs: [{ p: '11433', base: 3, a: false }, { p: '11434', base: 7, a: true }, { p: '11501', base: 16, a: true }] },
  '875A-10': { cl: 2045, sl: 2, lt0: 'PERDIZES', lt1: 'AEROPORTO',
    vs: [{ p: '21010', base: 4, a: false }, { p: '21022', base: 13, a: false }] },
};

function horaSP(offsetMin) {
  const d = new Date(Date.now() + (offsetMin || 0) * 60000);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function previsao(cp) {
  const parada = PARADAS.find((p) => p.cp === cp);
  if (!parada) return { hr: horaSP(), p: null };
  const ciclo = Math.floor(Date.now() / 60000) % 20; // avança 1 min por minuto
  const l = Object.entries(FROTA).map(([c, linha]) => ({
    c, cl: linha.cl, sl: linha.sl, lt0: linha.lt0, lt1: linha.lt1,
    vs: linha.vs.map((v) => {
      const min = (((v.base - ciclo) % 20) + 20) % 20;
      return { p: v.p, t: horaSP(min), a: v.a, ta: new Date().toISOString(), py: parada.py, px: parada.px };
    }).sort((x, y) => x.t.localeCompare(y.t)),
  }));
  l.forEach((x) => { x.qv = x.vs.length; });
  return { hr: horaSP(), p: { cp: parada.cp, np: parada.np, py: parada.py, px: parada.px, l } };
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, corpo, headers) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) });
    res.end(JSON.stringify(corpo));
  };
  console.log(new Date().toISOString(), req.method, url.pathname);
  if (CENARIO === 'fora') return json(503, { Message: 'Serviço indisponível (simulado)' });

  if (req.method === 'POST' && url.pathname === '/v2.1/Login/Autenticar') {
    const ok = Boolean(url.searchParams.get('token')) && url.searchParams.get('token') !== 'invalido';
    return json(200, ok, ok ? { 'Set-Cookie': COOKIE + '; path=/; HttpOnly' } : {});
  }
  if (!String(req.headers.cookie || '').includes(COOKIE)) {
    return json(401, { Message: 'Authorization has been denied for this request.' });
  }
  if (req.method === 'GET' && url.pathname === '/v2.1/Parada/Buscar') {
    const termo = String(url.searchParams.get('termosBusca') || '').toUpperCase();
    return json(200, PARADAS.filter((p) => (p.np + ' ' + p.ed).toUpperCase().includes(termo)));
  }
  if (req.method === 'GET' && url.pathname === '/v2.1/Previsao/Parada') {
    return json(200, previsao(Number(url.searchParams.get('codigoParada'))));
  }
  json(404, { Message: 'Rota não encontrada no simulador' });
}).listen(PORTA, () => {
  console.log('Simulador Olho Vivo em http://localhost:' + PORTA + '/v2.1  (cenário: ' + CENARIO + ')');
});
