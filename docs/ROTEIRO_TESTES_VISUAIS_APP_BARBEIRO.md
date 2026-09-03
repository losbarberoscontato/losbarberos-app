# Roteiro visual — App do Barbeiro

Data-base: 03/09/2026. Execute em desktop e em viewport mobile. Use uma barbearia de teste e um cliente de teste: os passos de agenda e Caixa podem gerar lançamentos financeiros reais.

## Preparação

1. No Gestor, crie ou escolha um profissional de teste, com foto, WhatsApp e `E-mail de acesso do Barbeiro`.
2. Marque `Liberar login do Barbeiro`, escolha `Somente a própria agenda`, habilite Caixa se for testar recebimentos e salve.
3. Garanta que o mesmo e-mail possui conta autenticável por senha ou Google. Para o teste multi-barbearia, cadastre o mesmo e-mail em uma segunda organização e também libere o acesso.

## 1. Entrada e autenticação

1. Abra `/barbeiro/entrar` sem sessão.
2. Confirme mesma paleta, logo, card, campos com ícones e botão Google da tela `/entrar` do Gestor.
3. Entre por senha; saia; entre por Google.
4. Confirme que ambos chegam apenas a organizações onde aquele e-mail está ativo na equipe.

Resultado esperado: autenticação não cria um vínculo; ela só libera vínculos já cadastrados pelo Gestor.

## 2. Conexão de barbearia

1. Com duas organizações ativas, entre em `/barbeiro`.
2. Confirme lista grande, com logo, nome e botão `Entrar` para cada barbearia.
3. Entre em uma delas. No seletor da organização no topo da barra lateral, clique para voltar à lista e troque de organização.
4. No Gestor, desative o login do Barbeiro em uma organização e atualize `/barbeiro`.
5. Desative em todas e confirme mensagem `Você não está conectado a nenhuma barbearia no momento.`

Resultado esperado: sem vínculo ativo, nenhuma Agenda ou Caixa pode abrir; somente Perfil continua acessível.

## 3. Menu e perfil

1. Dentro de uma organização, compare barra lateral, topbar, paleta, espaçamentos e estado ativo com `/gestor/agenda`.
2. Confirme presença apenas de `Agenda`, `Caixa` quando liberado e `Meu perfil`.
3. Confirme ausência de `Agendar`, `Reservas`, Equipe, Serviços e demais módulos de Gestor.
4. Em `Meu perfil`, altere nome, WhatsApp, foto e descrição; salve e atualize.
5. Confirme que serviços e comissão não possuem edição no App do Barbeiro.

## 4. Agenda própria e agenda completa

1. No Gestor, deixe o profissional em `Somente a própria agenda`; abra Agenda do Barbeiro.
2. Confirme layout idêntico ao calendário de Gestor: toolbar, data, filtros, Dia/Semana/Mês, colunas, cartões e paleta.
3. Crie atendimentos para esse profissional e para outro. Confirme que só o próprio aparece.
4. Altere para `Agenda completa da barbearia`; salve, atualize App do Barbeiro e confirme todos os profissionais/atendimentos visíveis.
5. Use `Novo agendamento` e confirme que o novo atendimento aparece no calendário permitido.
6. Em um atendimento permitido, valide ações disponíveis conforme status: iniciar, encerrar, registrar recebimento e cancelar. Confirme que confirmação manual continua exclusiva do Gestor.

Resultado esperado: escopo limita dados exibidos e operações; layout não muda.

## 5. Caixa individual e conciliação do Gestor

1. Com Caixa liberado, abra `Caixa` no App do Barbeiro e registre um recebimento de teste vinculado a atendimento permitido.
2. No Gestor, abra `Financeiro` e confira card `Conciliação` na visão geral e painel `Caixas dos Barbeiros` na aba Caixa.
3. Confirme nome do barbeiro, data, valor esperado, status e botão de conciliar.
4. Feche uma sessão sem diferença; confirme estado `Conciliado`.
5. Em outra sessão, informe valor diferente sem motivo: deve bloquear. Informe motivo e confirme fechamento.

Resultado esperado: Gestor concilia e fecha caixas diários individuais; Barbeiro não concilia o próprio caixa.

## 6. Regressão e responsividade

1. Repita pontos 1, 3 e 4 em viewport mobile.
2. Confirme que navegação inferior mostra apenas módulos liberados.
3. Abra rotas diretas sem permissão, por exemplo `/barbeiro/agenda?barbearia=<slug-inativo>` e `/barbeiro/caixa?barbearia=<slug-sem-caixa>`.
4. Confirme redirecionamento/bloqueio seguro, sem dados de outra organização.
5. No Gestor, edite e salve novamente o e-mail do profissional; atualize página e confirme persistência do valor.

## Registro de resultado

Para cada passo: URL, organização, e-mail de teste, navegador/viewport, resultado (`PASSOU`/`FALHOU`), captura e horário. Para falha, não use produção para novas tentativas financeiras até registrar estado do atendimento e caixa envolvidos.
