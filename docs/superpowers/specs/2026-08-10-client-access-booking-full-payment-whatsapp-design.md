# Cliente global, agenda pública, pagamento integral e WhatsApp — Design

## Objetivo

Entregar experiência mobile-first para cliente acessar uma barbearia por link, criar uma conta global no Los Barberos, vincular-se explicitamente ao tenant, agendar sem conflito e escolher entre pagamento integral via Mercado Pago ou pagamento no atendimento conforme regra da barbearia. A entrega também prepara e conecta notificações transacionais via WhatsApp Cloud API.

Carteira interna, saldo, crédito, sinal, mensalidade de cliente, busca pública e Google OAuth não fazem parte desta entrega.

## Princípios invariantes

- `auth.users.id` identifica conta global; e-mail nunca autoriza acesso.
- Todo vínculo operacional e dado comercial permanece isolado por `organization_id`.
- `payment_transactions` continua fonte de verdade para dinheiro recebido.
- Redirect do Mercado Pago não confirma pagamento; somente webhook assinado e idempotente.
- Escritas críticas de vínculo, agenda, pagamento, cancelamento e notificação passam por RPC ou Edge Function transacional.
- Ledgers e eventos existentes continuam append-only; registros históricos de sinal não são reescritos.
- Demo nunca grava no Supabase nem chama Mercado Pago ou Meta.

## Escopo

### Incluído

- Conta global do cliente com e-mail/senha, confirmação por e-mail e recuperação de senha.
- Perfil global canônico com nome, telefone, e-mail e nascimento controlado pelo cliente.
- Vínculo explícito do cliente com múltiplas barbearias.
- Entrada por `/b/[slug]`, preservando tenant durante autenticação.
- Home mobile da barbearia, logo, endereço, CTA de agendamento e próximo agendamento.
- Menu com troca entre barbearias vinculadas, conta e saída.
- Agenda por barbeiro ou data, com limite entre hoje e hoje mais 15 dias, inclusive.
- Pagamento integral Mercado Pago e opção de pagamento no atendimento.
- Regra tenant-wide `REQUIRED` ou `OPTIONAL` para pagamento online.
- Cancelamento e refund sem carteira.
- Link público copiável, logo e integrações nas configurações.
- WhatsApp Cloud API com Embedded Signup, até dois lembretes e ações web seguras.

### Excluído

- Carteira, saldo, reserva de crédito, crédito por cancelamento e expiração.
- Sinal fixo, percentual, obrigatório ou opcional.
- Assinaturas/mensalidades de clientes.
- Busca por nome, diretório e proximidade.
- Google OAuth do cliente.
- Transferência de valores entre tenants.
- Campanhas e marketing pelo WhatsApp.

## Arquitetura de identidade

### Perfil global

Uma tabela global de conta de cliente, vinculada por chave primária a `auth.users.id`, guarda os dados canônicos. RLS permite leitura e alteração somente pelo próprio usuário. E-mail confirmado vem do Supabase Auth; nenhuma tabela pública decide se e-mail está verificado.

Atualização do perfil ocorre por RPC autenticada. A RPC valida telefone E.164, nome e nascimento e sincroniza os snapshots de contato das relações tenant já vinculadas. A sincronização é iniciada pelo próprio cliente e auditada.

### Relação com barbearia

`customers` permanece a entidade tenant-scoped referenciada por agenda, pagamentos, consentimentos e histórico. Uma linha com `auth_user_id` representa vínculo confirmado entre conta global e organização.

O link não nasce somente por visita. Após autenticar, cliente vê identidade da barbearia e confirma “Entrar nesta barbearia”. Uma RPC idempotente cria ou retorna `customers` para aquele par `(organization_id, auth_user_id)`.

Gestor não altera dados globais de linha vinculada. Pode alterar notas, status e campos operacionais do tenant. Alterações de nome, telefone, e-mail e nascimento de cliente vinculado são recusadas no backend quando ator não é o próprio cliente.

### Cliente de balcão

Cadastro tenant-only sem `auth_user_id` continua permitido. Ao vincular uma conta global, contato verificado localiza candidatos por telefone ou e-mail exatos. Cliente confirma a correspondência. Ambiguidade, conflito de identidades ou histórico sensível gera solicitação de revisão; não ocorre merge automático por nome.

Merge reaproveita fluxo auditado existente e preserva agendamentos, pagamentos, consentimentos, tokens e histórico.

## Entrada e autenticação

`/b/[slug]` resolve slug público e encaminha ao app cliente mantendo contexto. Sem sessão, fluxo segue para `/cliente/entrar?barbearia=<slug>&next=<destino permitido>`.

`/cliente/entrar` oferece:

- entrar com e-mail e senha;
- criar conta com nome, telefone, e-mail e nascimento;
- checkbox de aceite com versão de política, sem afirmar adequação jurídica ainda não validada;
- confirmação de cadastro por e-mail;
- recuperação de senha;
- estados de e-mail pendente, link inválido, sessão expirada e conta existente.

Destinos de callback usam allowlist. Slug é normalizado e revalidado após autenticação. Google permanece oculto no cliente.

## Experiência mobile do cliente

### Home

`/cliente` deixa de redirecionar automaticamente para agendamento. Exibe logo, nome grande, endereço, estado de reservas, próximo horário e CTA “Agendar”. Não exibe saldo.

### Troca de barbearia

Menu sanduíche lista somente organizações com vínculo confirmado. Troca exige confirmação, atualiza contexto e deixa claro que agenda e histórico exibidos pertencem à nova barbearia. Não existe pesquisa pública nesta versão.

### Perfil

Cliente altera perfil global e consentimento transacional. Pedidos LGPD continuam auditados e tenant-scoped quando relacionados à operação da barbearia.

## Configurações da barbearia

Configurações conectadas passam a incluir:

- nome, slug, endereço e logo;
- link público copiável `/b/[slug]`;
- política de pagamento online `REQUIRED` ou `OPTIONAL`;
- estado da conexão Mercado Pago;
- estado da conexão WhatsApp;
- número operacional da barbearia;
- até dois lembretes, antecedência e template aprovado;
- prazo de cancelamento.

Campo de sinal é removido da interface. `deposit_bps` e snapshots antigos permanecem no schema para compatibilidade histórica, mas novos agendamentos do cliente gravam sinal zero e nunca oferecem `DEPOSIT`.

Política `REQUIRED` só pode ser ativada com conta Mercado Pago em estado conectado. Desconexão posterior impede novos agendamentos online obrigatórios e apresenta ação de reconexão; não rebaixa silenciosamente regra para opcional.

Logo usa bucket público dedicado a ativos de marca, com MIME, tamanho e dimensões limitados. Upload exige membro autorizado da organização; path inclui `organization_id` e substituição não apaga histórico comercial.

## Catálogo

Serviços e pacotes preservam preço integral, duração, descrição, públicos, composição e ativação. Nenhum campo de sinal ou carteira é criado. Pacote usa preço próprio já persistido.

## Agenda

### Seleção

Cliente escolhe público, serviço ou pacote e depois um dos modos:

- Por barbeiro: escolhe profissional e vê seus horários livres.
- Por data: vê opções compostas por horário e profissional, conforme layout A aprovado.

Somente profissionais ativos, compatíveis com os serviços resolvidos e dentro da escala aparecem.

### Horizonte

UI e banco permitem início entre a data local atual da organização e a data local atual mais 15 dias, inclusive. Validação usa timezone IANA da organização e ocorre novamente na criação do hold.

Consulta por data usa RPC tenant-safe que retorna pares de profissional e horário já filtrados. A UI não monta disponibilidade confiando apenas em chamadas independentes.

### Concorrência

Hold continua com expiração configurada, slot de 15 minutos e constraint GiST. Conflito devolve erro tratável e obriga nova escolha. Reagendamento segura novo slot antes de liberar anterior.

## Pagamento integral Mercado Pago

### Política obrigatória

Após revisão, sistema cria hold em modo `FULL`, cria `payment_order` integral e chama Edge Function de checkout. Preferência Mercado Pago contém referência opaca vinculada a `organization_id`, `appointment_id` e `payment_order_id`, além de chave de idempotência.

Agendamento só chega a `CONFIRMED` após webhook assinado registrar `payment_transaction` capturada. Falha ou expiração libera horário de forma idempotente.

### Política opcional

Cliente escolhe “Pagar agora” ou “Pagar no dia”. “Pagar agora” usa fluxo integral. “Pagar no dia” cria hold em modo `COUNTER` e o confirma sem checkout, mantendo valor integral pendente para atendimento.

Se Mercado Pago estiver desconectado e política for opcional, somente `COUNTER` aparece. Política obrigatória desconectada bloqueia criação e explica reconexão necessária.

### Pagamento tardio

Webhook recebido após expiração nunca recupera ou recria horário. Transação é registrada e encaminhada a refund/revisão operacional. Reprocessamento do mesmo evento não duplica transação nem refund.

### Cancelamento

Sem carteira, nenhum cancelamento cria crédito interno. Dentro do prazo configurado, cancelamento do cliente inicia refund integral pelo Mercado Pago. Fora do prazo, cancelamento pode liberar agenda, mas pagamento entra em revisão manual; não existe retenção ou refund automático implícito. Falha de refund cria job operacional idempotente.

## WhatsApp

### Conexão

Barbearia conecta WABA e número por Meta Embedded Signup. Conta e número pertencem à barbearia. Tokens ficam no Vault; tabelas públicas guardam somente IDs opacos, status e metadados não secretos.

Implementação externa depende de Meta App, configuração de Embedded Signup, App Review, permissões avançadas e templates aprovados. Quando execução atingir esse gate, trabalho pausa e solicita ao usuário apenas IDs/configurações necessárias, sem mostrar ou registrar secrets em chat/log.

### Mensagens

Outbox envia:

- confirmação ao cliente;
- novo agendamento ao barbeiro;
- fallback ao número operacional quando barbeiro não possui telefone operacional consentido;
- até dois lembretes ao cliente;
- confirmação ao barbeiro após cliente confirmar presença;
- eventos de cancelamento ou solicitação de reagendamento.

Usuário escolhe antecedência e estilo entre templates estruturados aprovados. Texto arbitrário não é enviado como template sem aprovação Meta.

### Ações seguras

Botões Confirmar, Cancelar e Reagendar abrem página web com token opaco, expirável, vinculado ao destinatário e de uso único. Cancelamento pede motivo e confirmação em duas etapas. Reagendamento cria solicitação manual para barbearia; não altera horário pelo WhatsApp.

## Demo e modo conectado

Demo mantém fixtures locais e simula estados visuais. Não invoca Supabase, Mercado Pago ou Meta. Modo conectado usa Supabase Auth, RLS, RPCs e Edge Functions reais. Testes e evidências devem nomear explicitamente qual modo foi validado.

## Erros e estados operacionais

- Slug inexistente: estado de barbearia não encontrada, sem criar vínculo.
- E-mail não confirmado: orientar reenvio, sem criar cliente tenant.
- Cliente já vinculado: RPC idempotente retorna vínculo existente.
- Possível duplicidade: abrir revisão, sem merge automático.
- Horário perdido: preservar seleção de serviço e pedir novo horário.
- Mercado Pago desconectado: permitir `COUNTER` somente em política opcional.
- Checkout expirado: liberar hold e permitir reinício seguro.
- Webhook duplicado: retornar sucesso sem duplicar efeitos.
- Pagamento tardio: registrar e encaminhar para refund/revisão.
- WhatsApp indisponível: agendamento não falha; mensagem fica em retry/outbox.
- Token de ação inválido ou usado: nenhuma alteração; orientar abertura do app.

## Segurança e privacidade

- RLS por autoacesso no perfil global e por organização nas relações.
- RPCs validam `auth.uid()`, vínculo e organização em todas as escritas.
- Perfil global nunca é listado publicamente.
- Busca de candidato por contato não revela existência de conta antes de verificação.
- Rate limiting e proteção contra enumeração cobrem cadastro, login, recuperação e resolução de slug.
- Logo é ativo público; dados privados e respostas autenticadas nunca entram no service worker.
- Consentimento transacional não habilita marketing.
- Secrets permanecem em Vault/Edge Functions.

## Estratégia de migrations

Migrations serão incrementais e compatíveis. Nenhuma coluna histórica de pagamento será removida. Novas tabelas, enums, colunas, índices, políticas e RPCs terão defaults seguros e não reclassificarão agendamentos existentes.

Mudanças de contrato serão introduzidas de forma compatível com código publicado. Backfill limitar-se-á a dados determinísticos; vínculos ambíguos permanecerão pendentes para revisão.

## Testes e validação

### Automatizados

- Identidade global, RLS self-only e bloqueio de edição por gestor.
- Vínculo explícito, idempotência e isolamento multi-tenant.
- Claim de cliente tenant-only com contato verificado e conflito manual.
- Callback preservando slug e bloqueando open redirect.
- Horizonte hoje até hoje mais 15 dias em timezone da organização.
- Disponibilidade por barbeiro/data e conflito concorrente.
- Política `REQUIRED`/`OPTIONAL` e fallback `COUNTER`.
- Checkout integral, webhook duplicado, pagamento tardio e refund.
- Remoção de sinal das novas telas e contratos.
- Outbox WhatsApp, fallback ao número operacional, dois lembretes e tokens de uso único.
- Demo sem chamadas externas.

### Gates locais

- ESLint.
- TypeScript.
- Vitest completo e testes focados.
- Build Next.js.
- Smoke HTTP local.
- E2E mobile cliente e desktop configurações.

### Gates externos

Supabase remoto, Mercado Pago sandbox, Meta test number, GitHub e Vercel exigem autorização explícita separada. Sem essas provas, resultado permanece local ou sandbox e não será declarado produção validada.

## Ordem de entrega

1. Fundação de identidade e vínculo.
2. Autenticação e home mobile.
3. Configurações de marca e política de pagamento.
4. Agenda por barbeiro/data e horizonte de 15 dias.
5. Checkout integral e cancelamento/refund.
6. WhatsApp Embedded Signup, lembretes e ações.
7. QA, hardening e publicação controlada.

## Critério de aceite

Cliente consegue abrir link de uma barbearia, cadastrar ou entrar, confirmar vínculo, trocar entre vínculos existentes, agendar sem conflito por barbeiro ou data e concluir conforme política `REQUIRED` ou `OPTIONAL`. Pagamento integral só confirma por webhook. Cancelamento não cria carteira. Notificações falhas não invalidam agendamento. Demo permanece local e todos os testes de isolamento, idempotência e build passam.
