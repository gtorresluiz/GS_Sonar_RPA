// NÓ: Preparar consultas — extrai o cookie de sessão e agrupa os cadastros por parada
// (uma chamada à API por parada, mesmo que vários usuários usem a mesma).
const login = $input.first().json;
const setCookie = [].concat((login.headers || {})['set-cookie'] || []);
const cookies = setCookie.map((c) => String(c).split(';')[0]);
const cookie = cookies.find((c) => c.startsWith('apiCredentials')) || cookies[0] || '';

const cadastros = $('Carregar cadastros').all().map((i) => i.json);
const paradas = [...new Set(cadastros.map((c) => c.codigo_parada))];
log('INFO', 'login_ok', { paradas_a_consultar: paradas.length, cadastros: cadastros.length });

return paradas.map((p) => ({ json: { codigo_parada: p, cookie } }));
