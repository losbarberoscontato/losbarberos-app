---
title: Requisitos da home de vendas para gestores
date: 2026-08-26
topic: home-gestor
---

# Requisitos da home de vendas para gestores

## Summary

Redesenhar a home `/` como página de venda do Los Barberos para gestores de barbearia. A página prioriza criação de conta com 14 dias grátis e acesso de gestor, preservando as rotas atuais.

---

## Problem Frame

A home com muitos links de entrada disputa atenção entre gestor e cliente. O visitante que administra uma barbearia precisa entender rapidamente o impacto comercial do sistema e encontrar uma ação clara para iniciar ou acessar sua operação.

---

## Key Decisions

- **Gestor primeiro.** A home fala primeiro com barbearias em operação que ainda dependem de WhatsApp, agenda dispersa e planilhas, sem excluir quem está abrindo uma unidade.
- **Estrutura A.** A primeira dobra apresenta uma promessa comercial direta, uma prévia do produto e dois acessos: criação de barbearia como ação principal e login do gestor como ação secundária.
- **Teste sem cartão.** A comunicação informa 14 dias grátis sem cartão nesta fase. Stripe, mensalidade e liberação comercial ficam para a migração ao domínio oficial.
- **Prova honesta.** A página não publica métricas, avaliações ou depoimentos como fatos enquanto não houver evidência real. Dados na prévia visual do produto são ilustrativos.

---

## Requirements

**Mensagem e conversão**

- R1. A home deve usar a chamada “Horário vazio custa caro. Gestão improvisada custa mais.” como direção principal de copy, seguida de explicação curta e objetiva do valor do produto.
- R2. A ação principal deve levar ao cadastro existente com texto orientado a criar a barbearia e iniciar 14 dias grátis.
- R3. A ação secundária deve levar ao login existente do gestor com texto inequívoco de acesso ao painel.
- R4. A página deve reduzir CTAs repetidos e manter uma hierarquia clara entre iniciar teste e entrar.

**Conteúdo e navegação**

- R5. A home não deve exibir links ou CTAs para login, agendamento ou experiência do cliente.
- R6. As rotas atuais de login e cadastro devem permanecer inalteradas.
- R7. A página deve comunicar teste grátis sem cartão sem introduzir checkout, preço, Stripe ou cobrança recorrente.
- R8. A página deve remover prova social inventada, incluindo métricas, estrelas, avaliações e depoimentos apresentados como reais.

**Visual e qualidade**

- R9. A home deve preservar identidade Los Barberos e usar elementos visuais do próprio produto para demonstrar o painel do gestor.
- R10. Dados demonstrativos em imagens ou prévias do produto devem ser apresentados como ilustrativos quando puderem ser confundidos com resultados reais.
- R11. A home deve permanecer responsiva e acessível, com leitura e CTAs claros em desktop e celular.

---

## Scope Boundaries

- Fluxos de cliente, incluindo login, agendamento e experiência de reserva, ficam fora da home.
- Cadastro, autenticação, URLs e regras de acesso não mudam.
- Stripe, preço final, cobrança mensal e regras de conversão após o teste ficam para a migração ao domínio oficial.

---

## Success Criteria

- Um gestor entende em poucos segundos que Los Barberos organiza a operação da barbearia e sabe qual ação tomar.
- A página apresenta somente cadastro e login do gestor como portas de entrada ao sistema.
- Nenhuma afirmação comercial parece uma prova real sem evidência correspondente.
