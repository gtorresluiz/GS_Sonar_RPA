# Contrato da saída para o MVP — `data/status_mvp.json`

O robô regrava este arquivo a cada ciclo (1 minuto). Qualquer componente do Sonar — o app, o assistente de voz ou um painel — pode lê-lo para responder perguntas como *"o próximo 8000-10 é acessível?"* sem precisar chamar a API da SPTrans.

## Formato (versão 1)

```json
{
  "versao": 1,
  "gerado_em": "2026-11-18T10:30:00.000Z",
  "api_disponivel": true,
  "paradas": [
    {
      "codigo_parada": 340015329,
      "nome": "PARADA PAULISTA B/C",
      "linhas": [
        {
          "linha": "8000-10",
          "sentido": 1,
          "status": "ok",
          "proximo": { "minutos": 3, "acessivel": false },
          "proximo_acessivel": { "minutos": 6 },
          "veiculos_previstos": 2,
          "pct_acessiveis": 50
        }
      ]
    }
  ]
}
```

| Campo | Significado |
|---|---|
| `api_disponivel` | `false` quando a API Olho Vivo falhou. Nesse caso, `paradas` traz o último dado válido e `ultimo_status_valido` informa quando ele foi gerado. |
| `linhas[].status` | `ok`, `sem_previsao`, `linha_sem_previsao`, `erro_consulta` ou `resposta_inconsistente`. Só `ok` traz os campos de previsão. |
| `proximo` | Próximo veículo da linha, com o tempo em minutos e se é acessível. |
| `proximo_acessivel` | Próximo veículo acessível, ou `null` se não houver nenhum na previsão. |
| `pct_acessiveis` | Percentual de veículos acessíveis entre os previstos. |

O arquivo **não contém dados pessoais**: ele é agregado por parada e linha, não por usuário.
