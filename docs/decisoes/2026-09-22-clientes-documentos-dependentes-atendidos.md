# Clientes, documentos, dependentes e pessoa atendida

Status: aprovado para implementação em 2026-09-22.

## Decisões

- `customer_id` continua representando cliente titular, responsável pelo cadastro, histórico e WhatsApp.
- CPF/CNPJ é opcional, armazenado sem pontuação e mascarado na interface.
- Dependentes são tenant-scoped em `customer_dependents`, com limite de 8 registros ativos por cliente.
- Agendamento registra dependente opcional e snapshots para preservar histórico.
- Ausência de seleção sempre significa atendimento do titular.
- WhatsApp continua usando telefone e identidade do titular.

## Escopo

Cadastro de Clientes, cadastro manual no modal de Projetos, Perfil do cliente, agendamento normal/manual e agendamento de sessão de Projeto.

## Fora de escopo

Contato próprio, login, WhatsApp ou cobrança individual de dependente; migration remota, deploy, commit e push.
