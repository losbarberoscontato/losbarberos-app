# WhatsApp runtime — evidências e pendências

Data: 06/09/2026. Mudanças locais; sem push, deploy, migration remota ou ativação de organização.

## Evidências locais

- PostgreSQL PGlite executa a migration nova sem modificações sobre fixtures mínimas do domínio e funções V2 reais. Cobre separação de motores, lease vencido, rejeição de token antigo, resultado incerto, recibos fora de ordem, pausa preservada, consentimento, frequência, prioridade e FK entre organizações.
- Testes do transporte injetam falhas HTTP/rede/persistência; nenhuma chamada real à Evolution é feita.
- Testes de componentes verificam controles preservados e personalizadas condicionadas ao runtime.
- Teste de volume opt-in: `WHATSAPP_LOAD_TESTS=1 npm test -- tests/integrations/whatsapp-runtime-load.test.ts`. Cria 120 organizações, 60 mil clientes, 60 mil jobs de campanha e pico de 1.200 operacionais. Avança disponibilidade de conexão e conclusão de transporte artificialmente; verifica prioridade, exclusão por conexão e ausência de claims repetidos. Não mede capacidade da VPS nem SLA de envio.

## PENDENTE antes de ativar

1. Revisar/aplicar migration em ambiente controlado com schema completo; rodar testes transacionais e concorrência em conexões PostgreSQL independentes. PGlite não prova contenção entre processos, RLS hospedada nem políticas de Storage em produção.
2. Publicar Functions/UI, instalar worker e monitor externo independente. Verificar heartbeat, fila e alerta em até cinco minutos.
3. Comparar jobs esperados em SHADOW e promover uma organização com números controlados. Comprovar confirmação, lembrete, resposta, personalizada e imagem privada de ponta a ponta.
4. Ensaiar crash em etapas distintas, QR reconectado, exclusão após retenção e retomada de sessão. Registrar evidência de reconciliação de resultado incerto.
5. Medir carga real por marcos 10/500, 25/500, 50/10.000, 70/25.000, 100/50.000 e 120/60.000. Os testes locais não certificam 99% em 60 segundos.
6. Aos 25 pagantes, instalar VPS reserva e ensaiar propriedade única de sessão e recuperação em 15 minutos. Definir backup, RPO/RTO e eventual PITR separadamente.

## Acessos

- GitHub: autenticação CLI disponível no inventário desta execução.
- Supabase: inventário de migrations ligado consultado; migration nova somente local.
- VPS: chave local informada recusada para `lbadmin` e `root` com `Permission denied (publickey,password)`. Necessário autorizar a chave pública ou fornecer acesso funcional. Nunca enviar chave privada pelo chat.
- Vercel: conector solicitou reautenticação (`invalid grant`). Reconectar antes de depender dele para publicação/verificação.

Entrega em aparelho, experiência autenticada publicada, redundância e SLA: **NÃO VALIDADOS**.
