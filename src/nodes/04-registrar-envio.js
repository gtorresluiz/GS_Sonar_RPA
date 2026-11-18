// NÓ: Registrar envio (modo: uma vez por item) — grava auditoria e marca o aviso como enviado.
// Só marca como enviado se o e-mail saiu; se falhar, o robô tenta de novo no próximo ciclo.
const d = $('Decidir notificações').item.json;
const resposta = $json || {};

if (resposta.error) {
  log('ERRO', 'envio_falhou', {
    usuario: d.usuario_hash, linha: d.linha, tipo: d.status,
    mensagem: sanitizar(mensagemDeErro(resposta.error)),
    acao: 'nova tentativa no próximo ciclo',
  });
  return { json: { enviado: false, usuario: d.usuario_hash, tipo: d.status } };
}

const agoraMs = Date.now();
const estado = limparEstado(lerJson('estado.json', {}), agoraMs);
estado.enviados[d.chave] = agoraMs;
gravarJson('estado.json', estado);
log('INFO', 'notificacao_enviada', {
  usuario: d.usuario_hash, linha: d.linha, tipo: d.status, canal: 'email', destino: mascararEmail(d.email),
});
return { json: { enviado: true, usuario: d.usuario_hash, tipo: d.status } };
