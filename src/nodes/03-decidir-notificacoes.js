// NÓ: Decidir notificações — laço sobre os cadastros aplicando as regras de negócio.
const consultas = $('Preparar consultas').all().map((i) => i.json);
const respostas = $input.all().map((i) => i.json);

const previsoes = {};
consultas.forEach((c, i) => {
  const r = respostas[i];
  previsoes[c.codigo_parada] = r;
  if (!r || r.error) {
    log('ERRO', 'consulta_previsao_falhou', {
      codigo_parada: c.codigo_parada,
      mensagem: sanitizar(mensagemDeErro(r && r.error)),
    });
  }
});

const cadastros = $('Carregar cadastros').all().map((i) => i.json);
const agoraMs = Date.now();
const estado = limparEstado(lerJson('estado.json', {}), agoraMs);
const resultados = processarExecucao(cadastros, previsoes, estado, agoraMs, SAL);

const contagem = {};
for (const r of resultados) {
  contagem[r.status] = (contagem[r.status] || 0) + 1;
  const erro = r.status === 'erro_consulta' || r.status === 'resposta_inconsistente';
  log(erro ? 'ERRO' : 'INFO', 'decisao', {
    usuario: r.usuario_hash,
    linha: r.linha,
    codigo_parada: r.codigo_parada,
    status: r.status,
    proximo_min: r.proximo_min ?? null,
    proximo_acessivel: r.proximo_acessivel ?? null,
    proximo_acessivel_min: r.proximo_acessivel_min ?? null,
  });
}

gravarJson('estado.json', estado);
// Saída estruturada para o MVP (contrato em docs/contrato-saida-mvp.md)
gravarJson('status_mvp.json', montarStatusMVP(cadastros, previsoes, new Date(agoraMs).toISOString()));
log('INFO', 'resumo_decisoes', { processados: resultados.length, ...contagem });

return resultados.map((r) => ({ json: r }));
