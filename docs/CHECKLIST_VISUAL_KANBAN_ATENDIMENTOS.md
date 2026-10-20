# Checklist visual — agenda, assinaturas e Kanban de Atendimentos

Use uma organização de teste por produto: Los Barberos, Le Gras, Pro Stetic e Music Pro. Registre produto, organização, perfil, horário, resultado e captura de tela por item. Faça cobranças somente em Stripe teste. Não use clientes reais.

## 1. Módulo inativo (estado inicial)

- [ ] Em Configurações → Gerencia minha assinatura → Módulos, Kanban aparece inativo nos quatro produtos.
- [ ] Menu lateral do gestor e do profissional não mostra Kanban. A boleta de atendimento não mostra status Kanban.
- [ ] Agenda, início e encerramento de atendimento continuam utilizáveis; serviços avulsos abrem cobrança ao encerrar.
- [ ] Platform Admin vê formulário de preço mensal, Stripe Price IDs de teste e produção e aditivo, separados por produto. Sem publicação completa, ativação permanece indisponível.

## 2. Assinatura e agendamento

- [ ] Gestor e cliente conseguem agendar uma sessão elegível pelo fluxo normal. Conferir confirmação de data e hora para destinatários configurados.
- [ ] Parcela vencida e não paga bloqueia novo agendamento do cliente; gestor vê mensagem clara.
- [ ] Gestor usa exceção com motivo obrigatório. Conferir agendamento e registro de autor, data e motivo; motivo vazio ou curto não passa.
- [ ] Agenda livre bloqueia próxima sessão enquanto a anterior estiver pendente ou cancelada no prazo; libera após conclusão ou consumo por falta/cancelamento tardio.
- [ ] Agenda fixa conserva reservas futuras existentes.
- [ ] Cliente confirma presença: cliente e profissional recebem a mensagem configurada. Cliente cancela: ambos recebem aviso e horário libera. Pedido de atendimento chega ao gestor.
- [ ] Com WhatsApp indisponível, gestor vê pendência; mensagem enfileirada não é registrada como entregue. Conferir entrega real em aparelho separado.

## 3. Ativação e cobrança em Stripe teste

- [ ] Platform Admin publica preço de teste, preço de produção e aditivo de cada produto. Conferir valor mensal exibido ao gestor.
- [ ] Gestor lê aditivo, vê início da cobrança e aceita. Sem aceite não ativa.
- [ ] Ativação libera Kanban e cria exatamente um item recorrente na assinatura Stripe de teste, sem pró-rata. Em trial, cobrança inicia no primeiro ciclo pago.
- [ ] Repetir requisição após falha simulada: nenhum item duplicado. Desativação remove item sem crédito pró-rata; falha de sincronização mantém estado anterior.
- [ ] Nova versão de preço vale para nova ativação; assinatura já ativa mantém preço contratado. Webhook com itens em ordem diferente mantém preço base e Kanban corretos.

## 4. Quadros, cards e permissões

- [ ] Após ativação surgem Aguardando, À Fazer, Fazendo e Feito. Aguardando fica primeiro, não renomeia nem exclui. Demais quadros editam; quadro sem responsável não recebe card.
- [ ] Atendimento comum, pacote e sessão de assinatura criam um único card ao entrar em serviço, em Aguardando, atribuído ao profissional. Antes do início não há status na boleta. Atendimento de Projetos não entra neste Kanban.
- [ ] Gestor vê todos os cards e pode criar card manual com título livre; cliente e serviço são opcionais. Card manual não gera cobrança/comissão.
- [ ] Mover card transfere responsabilidade ao responsável do quadro. Voltar a Aguardando devolve ao profissional original. Profissional vê somente seus cards ativos.
- [ ] Movimentar card não muda status do atendimento, cobrança ou comissão. Boleta mostra quadro atual apenas com módulo ativo.
- [ ] Concluir exige confirmação, oculta card ativo e mantém atendimento intacto. Gestor consulta arquivo e reabre card.
- [ ] Desativar esconde menu/status imediatamente. Reativar recupera quadros, cards e histórico.

## 5. Aparência e acesso

- [ ] Conferir telas em desktop e celular: menu, Módulos, aceite, Kanban, boleta, modais, textos, rolagem horizontal e estados vazios/erro/carregamento.
- [ ] Conferir gestor e profissional em organizações diferentes: nenhum card, preço contratado ou dado de cliente cruza tenant.
- [ ] Registrar resultado como PASSOU, FALHOU ou NÃO VALIDADO. Para WhatsApp, diferenciar fila, webhook, estado persistido e recebimento no aparelho. Para Stripe, anexar IDs de teste e fatura sem expor segredos.
