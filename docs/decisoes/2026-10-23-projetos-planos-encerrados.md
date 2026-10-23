# Cancelamentos e arquivo de planos

Data: 23/10/2026  
Status: implementado e publicado

## Regras implementadas

- A gestão de Projetos mostra contratos cancelados na meta, filtra contratações por status e permite excluir somente parcelas ainda abertas.
- A exclusão de parcela usa RPC com escopo de organização, recusa valores baixados/settled e cancela a entrada financeira relacionada para preservar o histórico contábil.
- No app do cliente, projetos e assinaturas cancelados ou expirados entram em “Planos Encerrados” somente quando não houver parcela aberta/vencida nem sessão disponível/agendada. Até então, a situação é exibida como “Aguardando regular pendências”.
- A tela e regras usam módulos compartilhados do Display e se aplicam aos produtos que ativam esses módulos.

## Publicação

- Commit de código: `4ae4e740841a0fa32d59c2b03f4d8e869554bd04`.
- Migration: `20261023172902_archive_closed_customer_plans_and_delete_project_installment.sql` aplicada em `bwdjkhqshmppescunwer`.
- Vercel: deployment `dpl_GeHMJDnxztuwLX5LqSixSS6jHEZ4`, status `READY`.
- CI `39996560127` não ficou verde: três jobs falharam e E2E ainda estava em execução no momento do registro. Ver `HANDOFF.md` para o estado atualizado.
- Validação visual autenticada em produção permanece pendente.
