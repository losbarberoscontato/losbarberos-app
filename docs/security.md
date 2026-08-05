# Segurança e privacidade

## Controles

- RLS em toda tabela exposta.
- `service_role` somente em funções confiáveis.
- Segredos separados por ambiente e nunca logados.
- Stripe usa restricted key quando permissões permitirem.
- OAuth Mercado Pago usa `state` curto, imprevisível e single-use.
- Webhooks validam assinatura no corpo bruto antes de processar.
- Eventos externos possuem chave única e podem chegar repetidos ou fora de ordem.
- Ações WhatsApp usam nonce opaco, expiração, vínculo ao destinatário e consumo único.
- Mudanças sensíveis entram em trilha de auditoria.

## LGPD

- Barbearia controla dados de clientes; Los Barberos opera esses dados e controla conta/billing/segurança próprios.
- Consentimento transacional e marketing são finalidades separadas.
- Revogação adiciona destinatário à suppression list.
- Pedido de acesso, correção, exportação ou exclusão exige verificação de identidade e protocolo.
- Tenant cancelado recebe janela de exportação de 30 dias; depois dados não obrigatórios são apagados ou anonimizados.
- Obrigações fiscais, legal hold, TTL de backups e transferência internacional exigem validação jurídica antes de produção.

## Produção

Antes do go-live: revisar CSP, rate limiting distribuído, CAPTCHA, DPA/suboperadores, política de privacidade, rotação de chaves, restore de backup e resposta a incidentes.

## Bootstrap do platform admin

O primeiro administrador é concedido por UUID de `auth.users`, em operação SQL auditada por pessoa autorizada. E-mail nunca decide privilégio e não existe lista de administradores em variável pública. Depois do bootstrap, bloqueios de tenant passam apenas pela RPC administrativa e geram `organization_access_events`.
