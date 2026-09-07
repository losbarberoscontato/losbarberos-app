# Operação WhatsApp

O worker compartilha o runtime testado com o dispatcher Edge. Não mantém fila em memória.
O cron existente permanece recuperação de baixa frequência. Ambos usam os mesmos claims e tokens.

## Instalação e segredos

1. Inventariar Evolution, PostgreSQL/Redis do gateway, proxy, volumes, backup e uso de CPU/RAM antes de alterar a VPS.
2. Testar o endpoint `chat/getBase64FromMediaMessage` na versão instalada com número controlado.
3. Construir worker com uma imagem Node >=22.18 aprovada e fixada por digest em `NODE_IMAGE`.
4. Criar `/etc/los-barberos/whatsapp-worker.env` com permissão 0600, contendo `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Nunca versionar o arquivo. Em VPS onde o operador só tem `sudo docker`, definir `WHATSAPP_WORKER_ENV_FILE` no `.env` local do Compose para um arquivo `0600` em `/home/lbadmin/.config/los-barberos/`.
5. Configurar `WHATSAPP_ALERT_URL` como endpoint HTTPS independente da Evolution. Recebe apenas código operacional e instante, sem telefone, corpo ou chave. A autenticação, se exigida, usa `WHATSAPP_ALERT_TOKEN`.
6. Aplicar migration, publicar Functions e UI compatíveis, iniciar worker, conferir heartbeat. Ativar tenant somente após testes shadow e número controlado.

`docker compose -f infra/whatsapp/compose.yml up -d whatsapp-worker` inicia apenas o worker. Este comando NÃO foi executado pelo agente.

## Manager e licenças

Evolution Manager v2 deve ser construído/revisado a partir do commit `95d27b421b82fb6a6bf7ef6251c1ac9c8f78282f`, validado contra a versão instalada da Evolution e identificado por digest em `EVOLUTION_MANAGER_IMAGE`.
Uso restrito a administradores técnicos via SSH tunnel ou proxy autenticado. Não fornecer chave global aos tenants.
O Manager usa `compose.manager.yml` separado. Após definir a imagem revisada: `docker compose -f infra/whatsapp/compose.manager.yml --profile admin up -d`. O arquivo do worker não exige instalar o Manager.
Preservar logo, copyright e aviso de uso exigidos pela licença. Este sistema usa Evolution Manager como ferramenta administrativa separada quando esse perfil for instalado.
Referência: https://github.com/evolution-foundation/evolution-manager-v2/blob/95d27b421b82fb6a6bf7ef6251c1ac9c8f78282f/LICENSE

Astra Campaign foi consultado como referência conceitual. Nenhum código foi incorporado. Editor visual permanece fora desta entrega.

## Promoção, rollback e resultado incerto

- `set_whatsapp_runtime_engine(organization_id, 'SHADOW')`: mantém consumo legado e prepara observação. Consultar `whatsapp_runtime_shadow_report` antes da promoção.
- `set_whatsapp_runtime_engine(organization_id, 'ACTIVE')`: transfere consumo ao runtime novo. RPC recusa troca com jobs/eventos em andamento ou resultados incertos.
- Desativar automações e esperar trabalhos em andamento terminarem antes de rollback. Resolver `SEND_UNKNOWN` por evidência do provedor; nunca reclassificar como RETRY apenas para limpar a fila.
- Usar `whatsapp_runtime_reconcile` somente com ID confirmado no provedor e referência de evidência. Operação auditada; não envia mensagem.
- Se houver personalizadas pendentes, reconciliar/cancelar antes de voltar ao legado; ele não interpreta esse payload.
- Nunca restaurar banco antigo por cima de mensagens já entregues.

## Segunda VPS

Marco revisado pelo usuário: **25 clientes SaaS pagantes**, não 25 usuários totais nem primeiros pagantes.
Antes disso, falha da única VPS interrompe transporte; Supabase preserva jobs já persistidos.

Cadastrar servidores em `whatsapp_runtime_servers`. Migração de sessão exige:
1. Pausar envios da organização.
2. Parar e bloquear a instância antiga no host/proxy; um flag no banco sozinho não bloqueia a sessão Baileys.
3. Restaurar armazenamento de sessão em apenas um destino e atualizar credenciais/rota no Vault.
4. Associar a conexão ao servidor novo; verificar saúde, webhook e recebimento real; novo QR pode ser necessário.
5. Retomar envio e medir recuperação. Não executar a mesma sessão em dois servidores simultaneamente.

Metas (não comprovadas em produção): recuperação de sessão válida em 15 minutos; alerta em 5 minutos; jobs operacionais p99 até 60 segundos com dependências saudáveis. Leases/filas não eliminam indisponibilidade da Evolution ou perda catastrófica do banco.

Monitor independente deve consultar heartbeat/idade da fila e também saúde da VPS; o worker não consegue alertar quando a própria máquina está totalmente desligada. Configurar isso antes de declarar a meta de alerta atendida.

## Capacidade

Cenários: 10/500, 25/500, 50/10.000, 70/25.000, 100/50.000 e 120/60.000 (barbearias/clientes).
Executar testes simulados por conexão, pico de 10 lembretes às 08h por barbearia e campanhas concorrentes. Medir banco, latência, CPU/RAM, drenagem e reinícios na infraestrutura real antes de avançar cada marco. Não inferir capacidade de Baileys pela quantidade de clientes cadastrados.
Ampliar quando RAM >70%, CPU >60% por 15 minutos ou atraso p95 >30 segundos. Backup diário não equivale a RPO zero; ensaiar restauração e definir PITR separadamente.
