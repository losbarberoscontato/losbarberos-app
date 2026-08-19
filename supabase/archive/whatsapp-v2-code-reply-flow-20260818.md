# Backup — fluxo WhatsApp v2 com código

Estado preservado antes da migração `20260818221505_simplify_whatsapp_v2_reminder_replies.sql`.

## Contrato anterior

- T-45 e 08:00 exibiam `1 ABC123 — Confirmar` e `2 ABC123 — Cancelar`.
- Dispatcher aceitava `1 ABC123` ou `2 ABC123`.
- RPC: `process_whatsapp_v2_text_response(text, text, text, text, text)`.
- A seleção da solicitação pendente usava `short_code_hash`.

## Fontes preservadas

- [matching de telefone e RPC anterior](../migrations/20260818171344_match_whatsapp_brazilian_mobile_ninth_digit.sql)
- [leases e finalização de webhook](../migrations/20260818195010_repair_whatsapp_v2_webhook_completion_and_leases.sql)
- [assinatura única do claim](../migrations/20260818212552_fix_whatsapp_v2_claim_rpc_ambiguity.sql)

Para rollback, restaurar a assinatura RPC de cinco parâmetros da migration
`20260818171344`, restaurar o parser de `1|2 + código` e publicar novamente
o dispatcher. Não contém credenciais.
