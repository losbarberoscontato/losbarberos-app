# Financeiro e Relatórios

`payment_transactions`, `financial_entries`, `financial_settlements` e `commission_ledger` seguem fontes autoritativas. `financial_reporting_facts` somente consolida leitura; nunca replica ledger.

- `FORECAST`: agenda `CONFIRMED` ou `IN_SERVICE`; não é conta a receber.
- `ACCRUAL`: serviços concluídos, contas manuais por `competence_date` e comissão por `earned_at`.
- `CASH`: transações de pagamento, liquidações manuais e pagamentos de comissão.
- Transferências aparecem no extrato de contas, não no fluxo consolidado.

Recebimento de atendimento usa `record_manual_appointment_receipt_v2`. Permite parcial, exige conta financeira e plano de receita tenant-safe e grava classificação imutável ligada à `payment_transaction`.

Relatórios DRE e DFC são gerenciais. Não substituem escrituração contábil, conciliação bancária, obrigação fiscal ou demonstrações oficiais.

Diagrama: [fluxo financeiro](architecture/los-barberos-financeiro-relatorios.png).
