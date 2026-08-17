# Handoff — Los Barberos

## Correção do recebimento de respostas Evolution — 17/08/2026

- Causa confirmada no remoto: o lembrete de 45 minutos ficou `SENT`, os três tokens permaneceram sem consumo e nenhum `MESSAGES_UPSERT` chegou ao webhook após as respostas `1`, `2` e `3`.
- A instância QR estável havia sido criada quando somente `CONNECTION_UPDATE` era configurado. Nas reconexões seguintes, a Evolution devolvia `422` por a instância já existir e a configuração de webhook mais nova não era reaplicada.
- `whatsapp-qr-start` agora executa `/webhook/set/{instance}` também para instâncias existentes, habilitando `QRCODE_UPDATED`, `CONNECTION_UPDATE` e `MESSAGES_UPSERT` com o header assinado.
- `whatsapp-qr-health` reaplica a mesma configuração a cada verificação de 15 minutos. Falha passa a ser registrada como `WEBHOOK_CONFIGURATION_FAILED`, visível pelo estado operacional da integração.
- Não foi necessária migration nova: o dry-run remoto confirmou migrations sincronizadas até `20260817184337`.
- Edge Functions publicadas e `ACTIVE`: `whatsapp-qr-start` versão 12 e `whatsapp-qr-health` versão 4. A execução remota após o deploy registrou `CONNECTED`, saúde `OK` e nenhum erro.
- Validação local: ESLint sem erros e com 4 warnings conhecidos, TypeScript aprovado, Vitest `56/56` arquivos e `278/278` testes, build Next.js aprovado.
- O defeito era comum aos lembretes de 6 horas e 45 minutos, pois ambos dependem do mesmo webhook de entrada. A prova E2E da resposta e dos avisos ainda depende de novo agendamento em produção.

## Respostas numéricas e avisos operacionais do WhatsApp — 17/08/2026

- QR Web/Evolution permanece como o canal ativo deste escopo; Evolution API não é iniciada localmente e nenhuma alteração de VPS foi necessária.
- Lembretes de 6 horas e 45 minutos usam texto: `1` confirma, `2` inicia cancelamento com segunda confirmação e `3` solicita reagendamento.
- Confirmação de presença e cancelamento confirmado geram aviso para o WhatsApp do profissional responsável. Reagendamento gera aviso para o próprio WhatsApp Business conectado pelo gestor, com cliente, telefone, data/hora, serviço e profissional.
- A tela `/gestor/equipe` possui `WhatsApp do profissional`; números nacionais sem DDI recebem `+55` e o banco também normaliza/valida E.164.
- Mensagem não numérica recebida pelo webhook é encaminhada ao WhatsApp conectado do gestor para retorno manual. Mensagens enviadas pela própria conta são ignoradas pelo webhook para impedir loop.
- Migration remota aplicada e sincronizada: `20260817184337_barber_whatsapp_operational_notifications.sql`.
- Edge Function `whatsapp-qr-webhook` publicada `ACTIVE`, versão 15. `whatsapp-send-outbox` permanece `ACTIVE`, versão 13.
- Validação local: ESLint sem erros e com 4 warnings conhecidos, TypeScript aprovado, Vitest `56/56` arquivos e `277/277` testes, build Next.js aprovado.
- Recebimento real dos lembretes e dos avisos operacionais ainda exige teste E2E em produção; deploy e HTTP smoke não substituem essa prova.

## Fechamento WhatsApp híbrido — 13/08/2026

- Branch de entrega: `codex/whatsapp-local-finalization`; sempre conferir SHA e relação com `origin/main` no próximo preflight.
- Supabase `bwdjkhqshmppescunwer`: migrations remotas conferidas até `202608110007`. `supabase db push --linked --skip-vault --yes` confirmou banco atualizado; não houve nova mutation de schema nesta data.
- Edge Functions publicadas e `ACTIVE`: `whatsapp-webhook`, `whatsapp-send-outbox`, `whatsapp-embedded-signup-start`, `whatsapp-embedded-signup-callback`, `whatsapp-qr-start` e `whatsapp-qr-webhook`.
- O gestor tem a página conectada `/gestor/configuracoes/whatsapp`: Meta Cloud API por Embedded Signup e QR Web por Evolution API, estado, ativação, reconexão, desconexão e regras de comunicação. Segredos permanecem em Vault/Edge Functions; cada organização resolve somente o provider ativo.
- Meta: a verificação de negócio/análise ainda é externa e o número de teste apresentou restrição de país. Não declarar envio Meta validado antes de a Meta liberar e de o teste receber a mensagem no WhatsApp.
- QR Web: código e endpoints estão publicados, mas o piloto está bloqueado até existir VPS com Evolution API, Docker, HTTPS, persistência, chave do gateway e webhook assinado. Não há VPS nem conexão QR real validada.
- Automações: estrutura tenant-safe para confirmação, lembretes de 6h/45min, mensagem de boas-vindas, opt-out e status de entrega existe. Ainda falta substituir a regra legada `appointment_reminder_0700` pelas regras configuráveis e validar outbox end-to-end para ambos providers.
- Validação local anterior ao fechamento: ESLint sem erros (1 aviso `img`), TypeScript aprovado, Vitest `46/46` arquivos e `238/238` testes, `next build` aprovado. A falha herdada do perfil conectado foi corrigida para preservar o E.164 já salvo enquanto a inicialização assíncrona preenche o formulário.
- Rascunho `cloudflare-pages/` permanece fora desta entrega e sem deploy/DNS: não remover nem publicar sem autorização explícita.

## Estado publicado — 09/08/2026

- Repositório: `https://github.com/losbarberoscontato/losbarberos-app`.
- Branch: `main`.
- Entrega funcional mais recente publicada: `acb57df` (`merge: refine local cash movement layout`).
- Vercel oficial: `https://losbarberos-app.vercel.app` — smoke `/entrar` HTTP 200.
- Supabase: projeto `Los Barberos`, ref `bwdjkhqshmppescunwer`, migrations sincronizadas até `202608090003`.
- Stripe: Display SH em Test mode, price `price_1U18IW0StL37D8g9quhZW9RN`, trial de 14 dias.
- Tenant real de teste preservado: `Barbearia Central`.

## Entregas preservadas

- Catálogo com públicos, edição correta de pacotes e ativação/inativação tenant-safe.
- Clientes em modais de cadastro/edição.
- Histórico do cliente com dados básicos, última visita e agendamentos pagos concluídos.
- Inativação de cliente com motivo persistido em `customers.inactivation_reason` e data em `customers.inactivated_at`.
- Filtros Ativos/Inativos em Clientes.
- Clientes inativos excluídos da busca de novos agendamentos.
- Agenda conectada: Dia/Semana/Mês, filtros reais, badge diário, data reativa e slots de 15 minutos.
- Login sem credenciais demo, mensagens temporárias, telefone padrão `+55` e tipografia ampliada.

## Verificações desta fase

- Suíte Vitest aprovada.
- ESLint aprovado.
- TypeScript aprovado.
- Build Next.js aprovado.
- Migration `202608060005_customer_inactivation_reason.sql` aplicada e schema confirmado.
- GitHub `origin/main` confirmado em `ec80d03`.
- Vercel deployment manual `dpl_7iuPC5MEY2Mha2THeNwdR57GHg1d` ficou `Ready`; o domínio oficial respondeu HTTP 200 após o push.

## Caixa financeiro — publicado em 09/08/2026

- Caixa financeiro enviado ao `main` e publicado automaticamente pela integração GitHub/Vercel. Status Vercel de `acb57df`: `success`; domínio oficial `/entrar`: HTTP 200.
- Migrations incrementais `202608090001_financial_cash.sql`, `202608090002_chart_account_templates.sql` e `202608090003_cash_default_account.sql` estão aplicadas e sincronizadas no Supabase.
- `202608090002_chart_account_templates.sql` mantém template global com 42 planos do PDF (12 receitas e 30 despesas) e provisiona o plano automaticamente para cada nova organização.
- Tenant `Barbearia Central`: os três planos sem lançamentos foram substituídos com autorização explícita. A validação remota confirmou 42 planos, 40 vínculos hierárquicos e nenhum plano legado.
- Caixa: recebimento de agendamento mostra status do ledger (`Recebido`) separado da conta financeira, tem colunas e período. Coluna principal é `Cliente/Fornecedor`: nome acima e descrição completa abaixo, com quebra de linha.
- `202608090003_cash_default_account.sql` adiciona descrição e conta padrão tenant-safe `Caixa Físico`, com mapeamento `MANUAL/COUNTER`, sem sobrescrever configuração existente.
- O schema inclui contas financeiras, fornecedores, plano de contas, centros de custo, tags, lançamentos, liquidações append-only, transferências atômicas e mapeamento de pagamentos de agendamento para conta financeira.
- O Caixa usa `payment_transactions` como fonte de verdade para agendamentos. Estorno manual cria reversal, preserva `COMPLETED` e reabre somente o saldo financeiro; estorno de provedor online continua no fluxo do provedor.
- Rotas: `/gestor/financeiro/caixa`, `/contas-pagar`, `/contas-receber`, `/bancos`, `/fornecedores` e `/cadastros`. Financeiro preserva visão geral e comissões.
- Demo mostra dados locais e bloqueia toda escrita no Supabase. A interface foi inspecionada localmente em modo demo: submenu, Caixa, modal, vínculo de agendamento, bancos/caixas e bloqueio de persistência.
- Validação local final do ajuste visual: ESLint, TypeScript e `next build` aprovados; teste focado de Caixa `7/7`. A pipeline GitHub do commit de publicação deve ser conferida no próximo preflight caso ainda não esteja concluída.

## Trabalho local não publicado — 11/08/2026

- Branch de trabalho: `codex/client-platform`; sem push ou deploy nesta fase.
- Migrations `202608100001_client_global_identity.sql` e `202608110001_client_counter_booking_availability.sql` aplicadas e confirmadas no Supabase remoto `bwdjkhqshmppescunwer`.
- `client_accounts` é a identidade global do cliente. Nome, telefone e nascimento são sincronizados de forma controlada para os clientes tenant vinculados; e-mail é gerenciado pelo Supabase Auth.
- O perfil do cliente salva apenas pela RPC `upsert_my_client_account`. A tela do gestor identifica `auth_user_id`, explica o bloqueio e permite editar somente observações de um cliente vinculado; inativação e reativação continuam tenant-local.
- Home conectada do cliente mostra a barbearia vinculada, CTA de agendamento e troca somente entre vínculos confirmados. Não mostra carteira ou saldo.
- Novos agendamentos de cliente usam somente `COUNTER`: ficam `CONFIRMED`, com snapshots de sinal zerados e pagamento integral no atendimento. A agenda aceita hoje até hoje + 15 dias e também lista horários disponíveis por data antes da escolha do profissional.
- Validação local desta etapa: suíte de identidade `113/113`, lint, TypeScript, Vitest completo e build aprovados; smoke de produção local `/cliente/entrar`: HTTP 200. Verificação visual autenticada conectada fica pendente antes de qualquer publicação.
- Mercado Pago sandbox/produção, WhatsApp/Meta e e-mail transacional ainda não foram configurados ou validados nesta etapa.

## Entrega de acesso, agenda e recebimento — 11/08/2026

- A entrega foi integrada na `main` e o push foi confirmado. O domínio Vercel respondeu HTTP 200; deploy direto pela CLI ficou `PENDENTE` por autorização Vercel recusada.
- Ao concluir atendimento `COUNTER`, a agenda abre a boleta de recebimento; cancelar mantém o atendimento concluído e o saldo `UNPAID`.
- `Contas a receber` projeta atendimentos `COMPLETED` com saldo aberto e oferece `Receber`; a confirmação usa exclusivamente `payment_transactions`.
- A boleta preenche cliente, serviço/profissional, valor, datas, plano `1 · Receitas`, conta mapeada `MANUAL/COUNTER`, documento `ATD-<id>` e guarda os campos em metadados auditáveis.
- Não é criado `financial_entry` ou `financial_settlement` para pagamento de agendamento; isso evita dupla contagem no Caixa.
- Migration `202608110003_appointment_receipt_metadata.sql` aplicada e sincronizada no Supabase remoto `bwdjkhqshmppescunwer`.
- Validação local final: `npm.cmd run verify` aprovado; Vitest `41` arquivos / `227` testes; smoke local sem sessão autenticada respondeu `307` nas rotas protegidas.

## Regras para continuar

- Código, migrations, testes e estado remoto verificado são fonte de verdade.
- Preserve dados; migrations sempre incrementais e compatíveis.
- Investigue antes de corrigir e crie regressão quando viável.
- Nunca exiba chaves, tokens, cookies, `Authorization` ou secrets.
- Não execute escrita externa sem autorização explícita na conversa atual.
- Stripe permanece em Test mode; Mercado Pago, WhatsApp/Meta e Google Auth de clientes ficam fora do escopo.

## Páginas legais públicas para Meta — 12/08/2026

- Implementação isolada na branch `codex/legal-meta-release`, sem migration ou escrita no Supabase.
- Rotas públicas versão `1.0`: `/privacidade`, `/termos` e `/exclusao-de-dados`.
- Responsável público: `JULIO CESAR HEIDEN JUNIOR 05128841960`; contato LGPD: `contato@losbarberos.com.br`.
- Origem canônica centralizada em `NEXT_PUBLIC_SITE_URL`. Valor atual: `https://losbarberos-app.vercel.app`; no corte de DNS, alterar para `https://losbarberos.com.br`.
- Ícone oficial exportado em `public/icon-1024.png` e referenciado no manifesto.
- Conteúdo jurídico é uma versão genérica baseada na LGPD e ainda depende da revisão final do advogado. Não declarar aprovação jurídica ou aprovação da Meta sem prova posterior.
- Validação local antes da publicação: testes focados `8/8`, suíte serial `43` arquivos / `235` testes, ESLint, TypeScript, build Next.js e inspeção visual desktop/mobile aprovados.
- GitHub, CI, Vercel e URLs públicas desta entrega permanecem `PENDENTE` até o commit e a verificação remota do SHA publicado.
