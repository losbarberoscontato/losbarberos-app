# Filtro de pacotes no cabeçalho

## Objetivo

Posicionar o filtro Ativos/Inativos dentro do cabeçalho do card Pacotes, imediatamente ao lado do título.

## Decisões

- O título visual duplicado do filtro será removido.
- O select manterá `aria-label="Filtro de pacotes"`.
- `Ativos` continuará como seleção inicial.
- O filtro continuará afetando somente a lista de pacotes.
- O botão Novo pacote permanecerá alinhado à direita.
- Não haverá posicionamento absoluto.

## Validação

- Teste de interface confirma o valor inicial e a troca para inativos.
- Typecheck e teste focado devem passar.
