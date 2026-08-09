# Plano de contas em duas colunas

## Objetivo

Organizar o plano de contas em `Cadastros` para leitura rápida, sem mudar o schema financeiro nem o contrato das RPCs.

## Interface

- Manter o formulário de criação e edição no topo.
- Abaixo, mostrar duas colunas: `Receitas` e `Despesas`.
- Cada coluna começa recolhida e tem um botão próprio para mostrar ou ocultar seus planos.
- Em telas pequenas, as colunas ficam empilhadas.

## Ordem e hierarquia

- Cada linha mostra `código · nome`.
- Ordenar primeiro pelo código, com comparação numérica por segmentos (`1.2` antes de `1.10`), e depois pelo nome quando o código for igual ou ausente.
- Mostrar uma subconta logo abaixo da sua conta superior, com recuo visual.
- Contas sem superior permanecem no nível raiz da respectiva natureza.
- O seletor de conta superior lista somente contas ativas da mesma natureza, também na ordem hierárquica.

## Comportamento e segurança

- Receita nunca aparece na coluna de Despesas e vice-versa.
- Os botões existentes de editar, inativar e reativar permanecem disponíveis após expandir a coluna.
- O modo demo continua sem chamadas de escrita ao Supabase.
- Não há migration, alteração de dados, deploy ou escrita remota.

## Testes

- Cobrir separação Receita/Despesa, código visível, ordem por código e conta superior.
- Cobrir início recolhido e alternância de abrir/fechar por coluna.
