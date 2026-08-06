# Modal de clientes — Design

## Objetivo

Abrir cadastro e edição de clientes em modal interno, mantendo a lista visível e seguindo o padrão já usado pela Agenda.

## Abordagem

Reutilizar `modal-layer` e `form-modal` em `CustomersManager`. O mesmo formulário serve para criação e edição; estado `editing` define título, valores iniciais e operação de persistência. Backdrop, fechar e cancelar encerram o modal sem alterar dados.

## Preservação

Insert, update, normalização de telefone, filtros, mesclagem, RLS e `router.refresh()` permanecem sem alteração funcional.
