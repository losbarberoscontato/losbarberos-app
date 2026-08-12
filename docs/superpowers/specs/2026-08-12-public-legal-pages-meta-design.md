# Páginas legais públicas e preparação Meta — Design

## Objetivo

Publicar páginas públicas de Política de Privacidade, Termos de Uso e Exclusão de Dados para o Los Barberos, com conteúdo operacional compatível com a LGPD e com os campos exigidos pelo App Dashboard da Meta. A entrega também produz um ícone quadrado de 1024 × 1024 pixels a partir da marca vetorial existente.

Os textos entram em vigor como versão 1.0 em 12 de agosto de 2026. A revisão pelo advogado permanece pendente e será registrada somente na documentação interna; as páginas públicas não serão rotuladas como rascunho.

## Identificação pública

- Produto: Los Barberos.
- Responsável: JULIO CESAR HEIDEN JUNIOR 05128841960.
- Canal público de privacidade/LGPD: contato@losbarberos.com.br.
- Origem atual: https://losbarberos-app.vercel.app.
- Origem futura planejada: https://losbarberos.com.br.

Nenhum outro dado cadastral pessoal será publicado nesta fase.

## Arquitetura

### Rotas estáveis

- `/privacidade`
- `/termos`
- `/exclusao-de-dados`

As rotas serão Server Components estáticos e não acessarão cookies, autenticação, Supabase ou dados de tenant. Um componente compartilhado fornecerá cabeçalho, navegação legal, conteúdo semântico, contato e rodapé. CSS Module próprio evitará conflito com a interface administrativa.

### Migração de domínio

Uma configuração pública central definirá a origem canônica. Ela lerá `NEXT_PUBLIC_SITE_URL` e usará `https://losbarberos-app.vercel.app` como fallback seguro. URLs serão normalizadas sem barra final. Links internos permanecerão relativos.

Quando `losbarberos.com.br` estiver ativo, a migração exigirá apenas:

1. definir `NEXT_PUBLIC_SITE_URL=https://losbarberos.com.br` no ambiente de build;
2. publicar novo build;
3. atualizar domínio, URLs legais e OAuth no App Dashboard da Meta;
4. validar redirects e webhooks antes de remover o domínio Vercel da allowlist.

### Conteúdo jurídico-operacional

A Política de Privacidade explicará:

- papéis do Los Barberos como controlador dos dados próprios da plataforma e operador quando tratar dados em nome de barbearias clientes;
- categorias de dados cadastrais, agenda, pagamentos, comunicações e dados técnicos;
- finalidades e bases legais, incluindo execução de contrato, obrigação legal, exercício de direitos, legítimo interesse e consentimento quando aplicável;
- compartilhamento condicionado ao recurso usado com infraestrutura, autenticação, pagamentos e Meta/WhatsApp;
- transferências internacionais, segurança, retenção e cookies essenciais;
- direitos do titular e canal público de contato;
- tratamento de dados de menores sob responsabilidade de responsável legal;
- atualização e versão da política.

Os Termos de Uso explicarão:

- aceitação, elegibilidade e escopo do SaaS;
- responsabilidades de gestores, profissionais e clientes;
- obrigação da barbearia de possuir base legal para dados inseridos;
- regras de contas, agenda, integrações, pagamentos e conteúdo;
- disponibilidade, propriedade intelectual, uso proibido, suspensão e encerramento;
- limites compatíveis com direitos obrigatórios do consumidor;
- lei brasileira, foro legalmente competente e contato.

A página de Exclusão de Dados oferecerá dois caminhos:

1. cliente autenticado: Perfil e privacidade → Solicitar exclusão;
2. qualquer titular: e-mail para contato@losbarberos.com.br com assunto “Solicitação de exclusão de dados”.

A página explicará verificação de identidade, escopo da solicitação, preservação quando exigida por obrigação legal/regulatória ou exercício de direitos, anonimização quando aplicável e confirmação pelo canal seguro. Não prometerá exclusão absoluta ou prazo incompatível com a LGPD.

### Preparação Meta

As três URLs públicas serão adequadas para os campos:

- Privacy Policy URL: `/privacidade`;
- Terms of Service URL: `/termos`;
- User Data Deletion Instructions URL: `/exclusao-de-dados`.

O rodapé público apontará para as três páginas. O ícone Meta será `public/icon-1024.png`, renderizado do `public/icon.svg` existente para preservar a identidade visual.

## Testes e verificação

- Teste de UI comprovará título, responsável, canal LGPD, direitos, papéis controlador/operador e instruções de exclusão.
- Teste de contrato comprovará rotas e links legais no rodapé.
- Teste da configuração comprovará fallback atual e normalização de `NEXT_PUBLIC_SITE_URL`.
- O arquivo PNG será verificado como 1024 × 1024 e inspecionado visualmente.
- `npm.cmd run verify` comprovará lint, TypeScript, Vitest e build.
- Servidor local de produção será usado para smoke e inspeção mobile/desktop das três rotas.
- Após push autorizado, GitHub, CI, deployment Vercel e HTTP das três páginas serão verificados separadamente.

## Segurança e limites

- Nenhum segredo, token ou dado privado entra nas páginas ou no bundle.
- Nenhuma migration ou escrita Supabase faz parte desta entrega.
- As páginas não substituem revisão jurídica profissional; o handoff registrará a revisão pendente.
- Uma resposta HTTP 200 não provará aprovação da Meta nem fluxo autenticado.

## Fontes normativas

- Lei nº 13.709/2018 (LGPD), especialmente arts. 16 a 18: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- ANPD — Direitos dos titulares: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares
- ANPD — Titular de dados e agentes de tratamento: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1
- ANPD — Aviso de Privacidade: https://www.gov.br/anpd/pt-br/acesso-a-informacao/aviso-de-privacidade
