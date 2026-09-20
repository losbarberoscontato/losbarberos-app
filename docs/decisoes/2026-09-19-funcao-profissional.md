# Função do profissional

- Status: em-andamento; especificação revisada e aprovada pelo usuário em 20/09/2026.
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

## Handoff

- **Entrada:** página autenticada de Equipe com organização do gestor, profissionais existentes e catálogo `professional_functions` já aplicado.
- **Saída:** vínculo opcional persistido em `barbers.professional_function_id`, seletor carregado apenas com funções da organização e modal fechado depois de salvar com sucesso.

## Tasks

### T1 — Cobrir a associação de função com testes

- **Tipo:** test
- **Depende de:** _(nenhuma)_
- **Estimativa:** 30min
- **Critério de done:**
  - [ ] Teste da UI falha inicialmente por ausência do campo; cobre seleção e envio do ID no update.
  - [ ] Teste de migration cobre coluna nullable e chave estrangeira composta por organização.
- **Commit alvo:** `test(team): cobre vínculo de função profissional`

### T2 — Persistir a função no perfil do profissional

- **Tipo:** feature
- **Depende de:** T1
- **Estimativa:** 1h
- **Critério de done:**
  - [ ] Migration aditiva adiciona FK nullable tenant-safe em `barbers`.
  - [ ] `loadTeamData` carrega catálogo filtrado pela organização e o modal de edição pré-seleciona a função atual.
  - [ ] Salvar envia `professional_function_id`; sucesso fecha modal e atualiza a página.
- **Commit alvo:** `feat(team): vincula função ao profissional`

### T3 — Validar Supabase e dev server

- **Tipo:** infra
- **Depende de:** T2
- **Estimativa:** 30min
- **Critério de done:**
  - [ ] Testes focados, TypeScript e lint dos arquivos tocados passam.
  - [ ] Dry-run confirma apenas a migration deste recurso; push e consulta confirmam coluna/FK no projeto vinculado.
  - [ ] App inicia com hot reload e a rota `/gestor/equipe` responde localmente.
- **Commit alvo:** `test(team): valida atribuição de função`
