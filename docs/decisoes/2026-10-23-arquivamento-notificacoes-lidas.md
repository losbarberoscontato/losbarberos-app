# Arquivamento de notificações visualizadas — 23/10/2026

## Comportamento

- O sininho e o popover do gestor exibem somente notificações sem `read_at`.
- Ao abrir uma notificação, a aplicação grava `read_at`; após sucesso, remove o item do estado local e segue para o destino.
- O contador e o badge representam apenas notificações pendentes. Se a gravação falhar, o usuário vê uma mensagem e o item permanece disponível para nova tentativa.
- Consultas em andamento não devem reintroduzir itens arquivados; a lista é também filtrada pela organização carregada para evitar exibição transitória de dados de outro tenant.

## Persistência e escopo

A tabela `manager_notifications` já possui `read_at`, políticas de RLS por destinatário e organização e permissão de atualização para gestor autorizado. Não foi necessária migration nem alteração de Edge Function. O `ManagerShell` é compartilhado pelos produtos Display.

## Verificação

Typecheck e build passaram. Lint passou com 14 avisos preexistentes fora do arquivo alterado. Testes automatizados e validação visual autenticada não foram executados nesta entrega.
