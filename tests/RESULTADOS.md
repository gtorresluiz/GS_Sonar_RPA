# Resultados dos testes de ponta a ponta (simulação do n8n)

Gerado por `node tests/simular-n8n.js` em 2026-11-18T22:55:07.520Z.
O código executado é o mesmo exportado em `n8n/sentinela-sonar.workflow.json`; a API Olho Vivo e o SMTP são simulados.

| ID | Tipo | Cenário | Caminho percorrido no fluxo |
|---|---|---|---|
| S1 | Sucesso | Fluxo completo: login, consulta, decisão e envio de e-mails | Carregar cadastros → 3 cadastro(s) na janela<br>Autenticar/Login OK? → sim<br>Preparar consultas → 2 parada(s) a consultar<br>Decidir notificações → c-001:notificar_chegada, c-002:notificar_nao_acessivel, c-003:aguardando<br>Enviar e-mail → assunto: "Sonar: 8000-10 acessível chega em 6 minutos"<br>Enviar e-mail → assunto: "Sonar: próximo 8000-10 não é acessível"<br>Registrar envio → enviado, enviado |
| D1 | Decisão | Segunda execução no mesmo minuto: avisos já enviados não se repetem | Carregar cadastros → 3 cadastro(s) na janela<br>Autenticar/Login OK? → sim<br>Preparar consultas → 2 parada(s) a consultar<br>Decidir notificações → c-001:ja_notificado, c-002:ja_notificado, c-003:aguardando<br>Deve notificar? → não (Sem notificação) |
| D2 | Decisão | Ônibus longe do limiar: nenhuma notificação | Carregar cadastros → 3 cadastro(s) na janela<br>Autenticar/Login OK? → sim<br>Preparar consultas → 2 parada(s) a consultar<br>Decidir notificações → c-001:aguardando, c-002:aguardando, c-003:aguardando<br>Deve notificar? → não (Sem notificação) |
| F1 | Falha | API fora do ar (DNS/timeout) após as tentativas | Carregar cadastros → 3 cadastro(s) na janela<br>Autenticar/Login OK? → falha (erro HTTP)<br>Registrar falha da API → alerta ao admin: "[Sonar RPA] Falha ao acessar a API Olho Vivo" |
| F2 | Falha | Token recusado pela API, com alerta ao admin suprimido (já alertado há menos de 30 min) | Carregar cadastros → 3 cadastro(s) na janela<br>Autenticar/Login OK? → falha (login recusado)<br>Registrar falha da API → alerta ao admin suprimido |
| F3 | Falha | Consulta de uma parada falha; a outra segue normalmente | Carregar cadastros → 3 cadastro(s) na janela<br>Autenticar/Login OK? → sim<br>Preparar consultas → 2 parada(s) a consultar<br>Decidir notificações → c-001:erro_consulta, c-002:notificar_nao_acessivel, c-003:erro_consulta<br>Enviar e-mail → assunto: "Sonar: próximo 8000-10 não é acessível"<br>Registrar envio → enviado |
| F4 | Falha | SMTP recusa o envio: aviso NÃO é marcado como enviado (nova tentativa no próximo ciclo) | Carregar cadastros → 3 cadastro(s) na janela<br>Autenticar/Login OK? → sim<br>Preparar consultas → 2 parada(s) a consultar<br>Decidir notificações → c-001:notificar_chegada, c-002:notificar_nao_acessivel, c-003:aguardando<br>Enviar e-mail → assunto: "Sonar: 8000-10 acessível chega em 6 minutos"<br>Enviar e-mail → assunto: "Sonar: próximo 8000-10 não é acessível"<br>Registrar envio → FALHOU, FALHOU |
| F5 | Falha | Arquivo de cadastros corrompido: execução falha de forma explícita | Carregar cadastros → ERRO: Falha ao ler data/cadastros.json: Expected property name or '}' in JSON at position 2 (line 1 column 3) |

## Verificação de dados sensíveis nos logs

Nenhum token, cookie ou e-mail completo foi encontrado nos logs gerados (verificação automática).

Amostras: `logs/amostras/`.
