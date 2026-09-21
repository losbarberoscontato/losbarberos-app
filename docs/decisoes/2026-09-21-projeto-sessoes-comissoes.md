# Sessões de projetos e comissões do pacote

Status: aprovado para implementação local

## Decisões

- Contratos aceitos criam uma sessão operacional por posição do pacote.
- Cada sessão pode ter no máximo um atendimento ativo; cancelamento dentro do prazo libera a sessão.
- O profissional é escolhido entre os profissionais ativos vinculados aos serviços do pacote.
- O serviço agendado deve estar vinculado ao profissional no pacote.
- O atendimento usa `source = PROJECT` e não gera cobrança de sessão separada.
- Ao concluir o atendimento, a comissão vem exclusivamente de `project_package_service_assignments.commission_cents`.
- O lançamento é idempotente, aparece no Financeiro do projeto e no relatório global de Comissões, identificado como Projeto.
- A Agenda mostra `PR` ao lado do cliente para atendimentos de projeto.

## Fora de escopo

- Tarefas internas não agendáveis para outros profissionais.
- Pagamento automático da comissão.
- Aplicação remota de migrations, commit, push ou deploy nesta etapa.

## Critérios de aceite

- Um contrato ativo mostra todas as sessões do pacote.
- Não é possível agendar a mesma sessão enquanto houver atendimento em fluxo.
- Conclusão cria uma única comissão com o valor cadastrado no pacote.
- Cancelamento não cria comissão.
- A comissão é visível nas duas telas financeiras.
- Atendimentos de projeto exibem `PR` na Agenda.
