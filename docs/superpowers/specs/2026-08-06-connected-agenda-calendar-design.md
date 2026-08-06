# Agenda conectada com layout de calendário

## Objetivo

Aplicar à agenda conectada ao Supabase o mesmo padrão visual da agenda demonstrativa, sem misturar dados fictícios e preservando todas as ações reais.

## Experiência aprovada

- Dia: profissionais em colunas, horários em linhas e reservas posicionadas por início e duração.
- Semana: seis dias em colunas, reservas reais agrupadas por data e horário.
- Mês: calendário mensal com total real de reservas por dia; selecionar um dia abre a visualização diária.
- Filtros reais por profissional e status continuam disponíveis.
- Navegação anterior, próxima data e hoje atualiza o calendário imediatamente.
- O botão Novo agendamento abre um modal secundário igual ao da demonstração.
- O modal usa cliente, serviço ou pacote, profissional, data, horário em intervalos de 15 minutos, observações e motivo fora da escala.
- Clique numa reserva abre detalhes e preserva iniciar, concluir, confirmar sem pagamento, reagendar, no-show e cancelar.

## Dados

`loadAgendaData` continua tenant-scoped e passa também os itens snapshot de cada reserva para o calendário exibir o nome do atendimento. Nenhuma consulta ou componente usa `src/data/demo` no fluxo conectado.

## Validação

Testes cobrem agrupamento diário/semanal/mensal, posicionamento por horário, modal conectado e preservação dos filtros e ações.
