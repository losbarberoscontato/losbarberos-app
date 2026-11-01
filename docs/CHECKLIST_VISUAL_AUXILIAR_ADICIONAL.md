# Checklist visual — Auxiliar adicional

**Status:** pendente de validação visual autenticada. Este roteiro não representa teste já executado.

## Preparação

- [ ] Usar uma organização de teste separada para cada produto: Los Barberos, ProStetic, Le Gras e MusicPro.
- [ ] Em Configurações → Gerenciar minha assinatura → Módulos, confirmar o módulo “Permitir profissional auxiliar em atendimentos” e ativá-lo.
- [ ] Cadastrar pelo menos quatro profissionais ativos; manter WhatsApp conectado para os cenários de mensagem.
- [ ] Usar agendamentos de teste com serviço, combo/pacote, plano de assinatura e projeto, sem dados reais de clientes.

## Configuração e agenda

- [ ] Com módulo ativo, abrir novo atendimento manual e confirmar que a seção Auxiliares fica visível.
- [ ] Adicionar um, dois e três auxiliares. Confirmar que não é possível passar de três nem escolher o profissional principal ou repetir auxiliar.
- [ ] Escolher comissão fixa por unidade e conferir que a tela mostra quantidade e valor esperado.
- [ ] Escolher comissão percentual e conferir a indicação “preço de tabela”.
- [ ] Criar atendimento com serviço único e com combo/pacote; confirmar comissão configurável por serviço.
- [ ] Agendar uma sessão de projeto e confirmar que o mesmo campo de auxiliares aparece no modal.
- [ ] Abrir atendimentos existentes originados do app do cliente, serviço, combo, plano de assinatura e projeto; adicionar/editar auxiliares antes da conclusão.
- [ ] Confirmar no resumo do atendimento nomes dos auxiliares e comissões por serviço.
- [ ] Desativar o módulo e confirmar que os campos deixam de aparecer para novas edições. Reativar e confirmar que dados existentes continuam preservados.
- [ ] Confirmar que nenhum campo ou ação foi adicionado ao app do cliente ou app da equipe.

## Integridade financeira

- [ ] Anotar antes da edição o total cobrado, valores dos itens, saldo/recebimentos e valor do combo/plano/projeto.
- [ ] Adicionar ou alterar comissões e confirmar que todos esses valores cobrados permanecem idênticos.
- [ ] Concluir um atendimento de teste com comissão fixa e conferir o lançamento do auxiliar no extrato de comissões.
- [ ] Concluir outro atendimento com comissão percentual e conferir cálculo sobre preço de tabela, incluindo quantidade maior que um.
- [ ] Repetir a transição de conclusão e confirmar que a comissão não duplica.
- [ ] Cancelar um atendimento e confirmar que não há comissão ganha.
- [ ] Confirmar que atendimentos concluídos não permitem alteração de auxiliares; correções devem usar o fluxo existente de reversão/ajuste do ledger.

## WhatsApp

- [ ] Confirmar que a criação do atendimento envia ao auxiliar a mesma mensagem operacional habilitada para a equipe.
- [ ] Responder à confirmação pelo WhatsApp e confirmar a mensagem equivalente ao auxiliar.
- [ ] Confirmar cancelamento manual e cancelamento iniciado pelo cliente no WhatsApp; conferir a notificação ao auxiliar.
- [ ] Alterar data/horário e conferir a nova confirmação/notificação operacional ao auxiliar.
- [ ] Testar auxiliar sem WhatsApp cadastrado: atendimento e comissão continuam válidos, sem job de envio para esse auxiliar.
- [ ] Conferir cada mensagem na fila/job persistido, resultado do provedor e aparelho. `SUBMITTED` sozinho não comprova recebimento.
- [ ] Confirmar que eventual falha no enqueue/cópia da mensagem auxiliar não cancela nem impede a confirmação/cancelamento principal.

## Evidências a registrar

- [ ] Produto, organização de teste e módulo ativo/inativo.
- [ ] Capturas da tela Módulos, criação, edição e resumo do atendimento.
- [ ] Valores antes/depois do preço cobrado e lançamento de comissão com o cálculo conferido.
- [ ] IDs/estados dos jobs e prova de recebimento no aparelho para os fluxos WhatsApp.
- [ ] Resultado em desktop e viewport móvel para cada identidade de produto.
