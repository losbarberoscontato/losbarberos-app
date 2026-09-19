# Função do profissional

- Status: design aprovado pelo usuário; aguardando aceite da especificação.
- Origem: pedido de 19/09/2026 para associar profissionais ao cadastro de funções nas regras de negócio.

## Visão geral

O modal de edição do profissional terá um campo `Função` que lista as funções cadastradas para a mesma organização. A seleção será opcional; uma opção vazia permitirá remover a função atual. Ao salvar com sucesso, o valor será persistido no registro do profissional, o modal será fechado e os dados serão atualizados.

## Solução

- Adicionar `professional_function_id` nullable em `public.barbers`.
- Criar chave estrangeira composta `(professional_function_id, organization_id)` para `(professional_functions.id, organization_id)`, impedindo vínculo entre organizações.
- Carregar as opções de função no fluxo de dados da página da equipe, sempre filtradas por `organization_id`.
- Exibir o seletor no modal de edição, pré-selecionado com a função atual; ausência de funções cadastradas deixa o seletor sem opção selecionável além de vazio.
- Incluir o ID selecionado no update existente. Sucesso fecha o modal e atualiza a página; erro mantém o modal aberto e mostra a mensagem atual.

## Critérios de aceite

1. O modal de edição lista somente funções da organização do gestor e carrega a função atual do profissional.
2. É possível escolher uma função cadastrada ou limpar a seleção.
3. Salvar persiste a relação no banco e fecha o modal somente após sucesso confirmado; erro não fecha o modal.
4. A chave estrangeira composta impede associação com função de outra organização.
5. Testes cobrem exibição, submissão, fechamento em sucesso e permanência em falha.

## Fora de escopo

- Incluir o campo no cadastro de novo profissional.
- Exibir ou editar função no App do Barbeiro ou em outras telas.
- Alterar o cadastro de funções em Regras de negócio.
