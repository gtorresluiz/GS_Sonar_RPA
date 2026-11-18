// NÓ: Registrar falha da API — chega aqui se o login falhou (após 3 tentativas) ou foi recusado.
const item = $input.first().json || {};
const motivo = sanitizar(item.error
  ? mensagemDeErro(item.error)
  : 'login recusado pela API (token inválido ou expirado); resposta=' + JSON.stringify(item.body));

log('ERRO', 'api_indisponivel', { mensagem: motivo, acao: 'ciclo encerrado; nova tentativa no próximo minuto' });

// Resiliência: mantém o último status válido para o MVP, marcado como desatualizado.
const anterior = lerJson('status_mvp.json', null);
gravarJson('status_mvp.json', {
  versao: 1,
  gerado_em: new Date().toISOString(),
  api_disponivel: false,
  mensagem: 'Previsões da SPTrans indisponíveis no momento',
  ultimo_status_valido: anterior ? (anterior.api_disponivel ? anterior.gerado_em : anterior.ultimo_status_valido || null) : null,
  paradas: (anterior && anterior.paradas) || [],
});

// Alerta o administrador no máximo 1 vez a cada 30 min.
const admin = $env.SONAR_ADMIN_EMAIL;
if (!admin) return [];
const agoraMs = Date.now();
const estado = limparEstado(lerJson('estado.json', {}), agoraMs);
if (agoraMs - (estado.ultimo_alerta_admin || 0) < 30 * 60 * 1000) {
  log('INFO', 'alerta_admin_suprimido', { motivo: 'administrador já alertado nos últimos 30 min' });
  return [];
}
estado.ultimo_alerta_admin = agoraMs;
gravarJson('estado.json', estado);
log('INFO', 'alerta_admin_enviado', { destino: mascararEmail(admin) });

return [{
  json: {
    email: admin,
    assunto: '[Sonar RPA] Falha ao acessar a API Olho Vivo',
    texto: 'O robô Sentinela Sonar não conseguiu consultar a API Olho Vivo da SPTrans.\n'
      + 'Motivo: ' + motivo + '\n'
      + 'Execução n8n: ' + EXEC_ID + '\n\n'
      + 'O robô tenta de novo a cada minuto. Enquanto isso, os usuários não recebem avisos '
      + 'e o MVP recebe api_disponivel=false.',
  },
}];
