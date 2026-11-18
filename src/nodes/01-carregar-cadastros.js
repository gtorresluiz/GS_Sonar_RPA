// NÓ: Carregar cadastros — lê, valida, remove duplicados e filtra pela janela de horário.
const sp = agoraEmSaoPaulo(new Date());
let lista;
try {
  lista = lerJson('cadastros.json');
  if (!Array.isArray(lista)) throw new Error('o arquivo deve conter uma lista (array) de cadastros');
} catch (e) {
  log('ERRO', 'cadastros_ilegiveis', { mensagem: sanitizar(e.message) });
  // Falha explícita: a execução aparece como erro no n8n (sem falha silenciosa).
  throw new Error('Falha ao ler data/cadastros.json: ' + sanitizar(e.message));
}

const { validos, invalidos, duplicados } = validarCadastros(lista);
for (const inv of invalidos) log('AVISO', 'cadastro_invalido', { indice: inv.indice, motivo: inv.motivo });

const naJanela = validos.filter((c) => c.ativo && dentroDaJanela(c, sp));
log('INFO', 'inicio_execucao', {
  cadastros_total: lista.length,
  validos: validos.length,
  invalidos: invalidos.length,
  duplicados_removidos: duplicados,
  na_janela: naJanela.length,
});

if (naJanela.length === 0) return []; // ninguém para monitorar agora: encerra o ciclo
return naJanela.map((c) => ({ json: c }));
