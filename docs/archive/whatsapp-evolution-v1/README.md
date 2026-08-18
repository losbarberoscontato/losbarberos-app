# WhatsApp Evolution v1 — arquivado em 2026-08-18

Este diretório registra retirada do fluxo automático QR v1.

- QR Code, instância Evolution, Vault e estado de conexão foram preservados.
- Fluxos v1 de lembrete, resposta `1/2/3`, outbox QR e regras antigas foram desativados para QR pela migration `20260818023139_whatsapp_automation_v2_rebuild.sql`.
- Meta Cloud API não foi alterada.
- Código histórico continua recuperável no Git, antes desta migration. Arquivos relevantes: `supabase/functions/whatsapp-send-outbox/index.ts`, `supabase/functions/whatsapp-qr-webhook/index.ts`, `supabase/functions/_shared/whatsapp.ts`, migrations `20260811*` a `20260817*`.

V2 usa `whatsapp_automation_jobs`, `whatsapp_webhook_events_v2`, `whatsapp_confirmation_requests_v2` e `whatsapp-v2-dispatcher`. Não misturar tabelas v1 e v2.
