# Controles de serviços no catálogo

## Objetivo

Dar ao card Serviços o mesmo padrão de filtro e ativação do card Pacotes, preservando o fluxo de edição existente.

## Decisões

- Select Ativos/Inativos ao lado do título Serviços.
- Ativos selecionado por padrão.
- O filtro afeta somente serviços.
- Inativação e reativação exigem confirmação visual.
- Uma RPC `set_service_active` fará a alteração tenant-scoped.
- O fluxo Editar continuará preenchendo o formulário existente e será coberto por teste.
- A migration será incremental e não modificará dados existentes.

## Validação

- Testes de filtro, edição, confirmação e payload da RPC.
- Typecheck, lint e suíte completa.
