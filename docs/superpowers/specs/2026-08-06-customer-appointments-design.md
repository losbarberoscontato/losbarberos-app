# Histórico de agendamentos do cliente — Design

## Objetivo

Exibir última visita concluída na lista de clientes e abrir histórico completo em modal interno.

## Dados

O loader de Clientes buscará agendamentos, itens snapshot, resumo financeiro, barbeiros e eventos de reagendamento filtrados por `organization_id`. Nenhuma escrita ou migration será necessária.

## Regras de apresentação

- Última visita considera apenas agendamentos `COMPLETED` no passado.
- Serviço/pacote usa `appointment_items.service_name_snapshot`.
- Valor pago usa `appointment_financial_summary.net_paid_cents`.
- Reagendamento é identificado por evento append-only com `reason = appointment_rescheduled`.
- Modal mantém dados básicos do cliente e lista todos os agendamentos carregados.
