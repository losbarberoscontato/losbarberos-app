# Intervalo fixo de 15 minutos na agenda

## Objetivo

Garantir que novos agendamentos e reagendamentos usem somente horários em blocos de 15 minutos: `00`, `15`, `30` e `45`.

## Desenho aprovado

- A interface do gestor usa `step=900` nos campos de início e reagendamento.
- A validação client-side rejeita horários fora de múltiplos de 15 antes da chamada RPC.
- Configurações exibem apenas `15 minutos`.
- Migration incremental normaliza organizações existentes para 15 e substitui o check anterior por `slot_interval_minutes = 15`.
- A geração de disponibilidade do cliente continua usando a RPC existente; após a migration, o intervalo persistido será sempre 15.

## Validação

- Teste unitário cobre o intervalo oficial e horários válidos/inválidos.
- Teste de integração verifica a migration.
- Lint, typecheck, suíte completa e build devem passar.
