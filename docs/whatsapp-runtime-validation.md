# WhatsApp runtime — evidências e pendências

Data: 07/09/2026. Runtime publicado, sem organização ativada.

## VALIDADO

- PostgreSQL PGlite executa a migration nova sem modificações sobre fixtures mínimas do domínio e funções V2 reais. Cobre separação de motores, lease vencido, rejeição de token antigo, resultado incerto, recibos fora de ordem, pausa preservada, consentimento, frequência, prioridade e FK entre organizações.
- Testes do transporte injetam falhas HTTP/rede/persistência; nenhuma chamada real à Evolution é feita.
- Testes de componentes verificam controles preservados e personalizadas condicionadas ao runtime.
- Teste de volume opt-in: `WHATSAPP_LOAD_TESTS=1 npm test -- tests/integrations/whatsapp-runtime-load.test.ts`. Cria 120 organizações, 60 mil clientes, 60 mil jobs de campanha e pico de 1.200 operacionais. Avança disponibilidade de conexão e conclusão de transporte artificialmente; verifica prioridade, exclusão por conexão e ausência de claims repetidos. Não mede capacidade da VPS nem SLA de envio.
- Migration `20260906230249_whatsapp_reliable_runtime.sql` aplicada no Supabase vinculado; a lista remota confirma alinhamento.
- Functions `whatsapp-v2-dispatcher` v22, `whatsapp-qr-webhook` v34 e `whatsapp-qr-start` v16 publicadas. A checagem Deno e o CI executaram com sucesso.
- Interface publicada em `https://losbarberos-app.vercel.app`; o deploy `dpl_8K79NTfZayyJWUAVA34dJF6TCEQr` está `READY`. Smoke público retornou 200 e a rota protegida de configurações retornou 307 sem sessão.
- Worker dedicado instalado em `187.127.48.21`, com filesystem somente leitura, limites de 256 MiB/0,5 CPU, reinício automático e sem porta pública. O heartbeat persistido no Supabase foi lido a partir do processo em execução.
- A consulta do worker retornou zero organizações com `runtime_engine = ACTIVE`; nenhum envio novo foi habilitado por esta publicação.
- CI do PR #1 passou: verify, edge-functions, e2e e database. O e2e registrou 24 testes aprovados e 2 ignorados.

## PENDENTE antes de ativar

1. Configurar um alerta externo independente de WhatsApp e comprovar a detecção em cinco minutos. O worker suporta `WHATSAPP_ALERT_URL`, mas nenhum destino foi configurado.
2. Selecionar organização piloto e comparar jobs em `SHADOW`, sem envio. Depois, ativar somente com números controlados e comprovar confirmação, lembrete, resposta, personalizada e imagem privada de ponta a ponta.
3. Ensaiar crash em etapas distintas, QR reconectado, exclusão após retenção e retomada de sessão. Registrar evidência de reconciliação de resultado incerto.
4. Executar testes de RLS e contenção reais em conexões PostgreSQL independentes. PGlite não prova contenção entre processos nem políticas hospedadas de Storage.
5. Medir carga real por marcos 10/500, 25/500, 50/10.000, 70/25.000, 100/50.000 e 120/60.000. Os testes locais não certificam 99% em 60 segundos.
6. Aos 25 pagantes, instalar VPS reserva e ensaiar propriedade única de sessão e recuperação em 15 minutos. Definir backup, RPO/RTO e eventual PITR separadamente.

## Acessos

- GitHub: branch `codex/whatsapp-reliable-runtime` publicada e PR #1 aberto.
- Supabase: migration e três Functions publicados no projeto vinculado.
- VPS: acesso por `lbadmin` com chave SSH funcional; o worker usa arquivo privado de ambiente no host. Segredos não foram registrados neste documento.
- Vercel: projeto publicado e alias de produção verificado.

Entrega em aparelho, experiência autenticada completa, alerta externo, redundância entre VPS e SLA: **NÃO VALIDADOS**.
