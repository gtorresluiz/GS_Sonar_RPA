// Utilitário para montar os cadastros: descobre o código da parada e testa o token.
// Requer Node 18+. Lê OLHOVIVO_TOKEN do ambiente ou do arquivo .env na raiz.
//
//   node src/buscar-parada.js "Paulista"          → lista paradas cujo nome/endereço contém o termo
//   node src/buscar-parada.js --previsao 340015329 → mostra linhas e veículos previstos (e se são acessíveis)
const fs = require('fs');
const path = require('path');

function carregarEnv() {
  const arq = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(arq)) return;
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  carregarEnv();
  const token = process.env.OLHOVIVO_TOKEN;
  const base = process.env.OLHOVIVO_BASE_URL || 'https://api.olhovivo.sptrans.com.br/v2.1';
  if (!token) throw new Error('Defina OLHOVIVO_TOKEN no arquivo .env');

  const login = await fetch(base + '/Login/Autenticar?token=' + token, { method: 'POST' });
  const ok = (await login.text()).trim() === 'true';
  if (!ok) throw new Error('Login recusado: confira o token no .env');
  const cookies = login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get('set-cookie')];
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  console.log('Login OK no Olho Vivo.\n');

  const [arg1, arg2] = process.argv.slice(2);
  if (arg1 === '--previsao') {
    const r = await (await fetch(base + '/Previsao/Parada?codigoParada=' + arg2, { headers: { Cookie: cookie } })).json();
    if (!r.p) return console.log('Sem previsão para essa parada agora.');
    console.log('Parada', r.p.cp, '-', r.p.np, '| horário da API:', r.hr);
    for (const l of r.p.l) {
      console.log('\n  Linha', l.c, '| sentido', l.sl, '→', l.lt0);
      for (const v of l.vs) console.log('    prefixo', v.p, '| chega', v.t, '|', v.a ? 'ACESSÍVEL' : 'não acessível');
    }
    return;
  }
  if (!arg1) throw new Error('Uso: node src/buscar-parada.js "termo"  ou  --previsao CODIGO');
  const paradas = await (await fetch(base + '/Parada/Buscar?termosBusca=' + encodeURIComponent(arg1), { headers: { Cookie: cookie } })).json();
  if (!paradas.length) return console.log('Nenhuma parada encontrada.');
  for (const p of paradas.slice(0, 30)) console.log(String(p.cp).padEnd(12), p.np, '|', p.ed);
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
