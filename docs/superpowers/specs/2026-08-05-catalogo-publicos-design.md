# Catálogo: públicos, pacotes idempotentes e inativação

## Objetivo

Permitir classificar serviços e pacotes para um ou mais públicos, filtrar o catálogo no agendamento do cliente, corrigir a edição de itens de pacotes e inativar pacotes com confirmação visual. Dados existentes devem ser preservados.

## Públicos

Valores persistidos em `text[]`, com validação SQL:

- `INFANTIL`
- `FEMININO`
- `MASCULINO`
- `OUTROS_SERVICOS`

`services.audiences` e `packages.audiences` serão `not null default '{}'`. Registros atuais começam vazios e ficam ocultos do catálogo público até classificação. Novos registros exigem pelo menos um público. A seleção no gestor será múltipla.

O RPC público `get_public_booking_context` retornará `audiences` para serviços e pacotes. O cliente exibirá um filtro de público antes das opções; somente itens ativos com o público selecionado serão mostrados. A experiência demo receberá a mesma regra e dados de demonstração classificados.

## Pacotes

`save_package_with_items` continuará usando substituição transacional: ao editar, desativa itens atuais e insere o conjunto enviado. Leituras do gestor, seleção inicial de edição e contagem usarão somente `package_items.active = true`. Itens históricos inativos não serão apagados nem somados.

O RPC validará públicos e serviços ativos do mesmo tenant. A atualização de pacote manterá `active`, preço, descrição e ordem, salvo alterações explícitas.

## Inativação

O botão `Inativar` de pacote abrirá modal visual com a mensagem `Deseja inativar este pacote?`. Cancelar fecha sem mutação. Confirmar executa atualização tenant-scoped de `active = false`. O pacote continuará disponível para reativação pelo gestor, mas ficará ausente do catálogo público. Serviços inativos também não serão exibidos pelo contexto público.

## Segurança e dados

- Migration incremental; nenhuma linha existente será removida.
- Todas as mutações continuarão limitadas por `organization_id` e RPC/RLS existentes.
- Catálogo público seguirá expondo somente projeção segura e itens ativos.
- Valores financeiros continuam em centavos; nenhuma alteração de ledger ou reservas existentes.

## Testes

- Migração/RPC: públicos válidos, seleção vazia rejeitada em novos registros e isolamento por organização.
- Gestor: seleção múltipla, edição de pacote sem soma de itens inativos e modal de confirmação/cancelamento.
- Cliente: filtro por público, ocultação de itens sem público e de itens inativos, em modo conectado e demo.
- Regressão: pacote editado reflete exatamente conjunto atual de serviços.
- Validação final: lint, typecheck, Vitest, build e E2E aplicáveis.

## Publicação

Após validação local, publicar código no GitHub/Vercel. Aplicar migration e atualizar Edge/RPC no Supabase somente quando necessário e autorizado, confirmando preservação e smoke-check no ambiente publicado.
