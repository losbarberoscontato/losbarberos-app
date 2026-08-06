# Tipografia legivel — Design

## Objetivo

Aumentar a legibilidade da interface em aproximadamente 12%, preservando responsividade PWA, hierarquia visual e alvos de toque adequados para futura camada nativa iOS/Android.

## Abordagem

Aplicar ajuste tipográfico central em `src/app/globals.css`, elevando o corpo e os textos pequenos de forma explícita, sem usar zoom global que alteraria dimensões de layout. Títulos hero e espaçamentos estruturais permanecem intactos; regras mobile continuam controlando a composição em telas estreitas.

## Validação

Adicionar uma asserção de regressão no teste E2E da entrada para garantir que a página mantenha `font-size` legível no formulário. Rodar teste focado, lint, typecheck e build/testes existentes aplicáveis.
