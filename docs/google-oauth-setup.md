# Google OAuth — configuração do Los Barberos

Este guia conecta o mesmo provedor Google ao acesso de gestor e cliente. O Google fornece identidade básica; autorização de gestor e tenant scope continuam sendo decididos pelo banco. No primeiro acesso do cliente, o app exige WhatsApp, data de nascimento e aceite dos termos antes de criar `client_accounts`.

## 1. Google Auth Platform

1. No Google Cloud Console, crie ou selecione o projeto `Los Barberos`.
2. Abra **Google Auth Platform > Branding** e informe nome, e-mail de suporte, logo e contatos do desenvolvedor.
3. Em **Audience**, selecione **External**. Durante homologação, mantenha **Testing** e cadastre os e-mails de teste.
4. Em **Data Access**, mantenha apenas os escopos básicos:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
5. Em **Clients**, crie um cliente do tipo **Web application**.

### Authorized JavaScript origins

```text
https://losbarberos-app.vercel.app
http://localhost:3000
```

Quando o domínio oficial estiver servindo o app, adicione também:

```text
https://losbarberos.com.br
```

### Authorized redirect URI

Use o callback exato exibido no provedor Google do projeto Supabase. Para o projeto atual:

```text
https://bwdjkhqshmppescunwer.supabase.co/auth/v1/callback
```

O redirect URI do Google é o callback do Supabase, não `/auth/callback` do Next.js.

## 2. Supabase Auth

1. Abra **Authentication > Sign In / Providers > Google**.
2. Ative o provedor.
3. Cole o **Client ID** e o **Client Secret** diretamente no Dashboard do Supabase.
4. Salve.

Nunca envie o Client Secret por chat, commit, log ou variável `NEXT_PUBLIC_*`. O app não precisa guardar tokens do provedor Google nem solicitar acesso offline.

Em **Authentication > URL Configuration**, use:

```text
Site URL: https://losbarberos-app.vercel.app
Redirect URLs:
https://losbarberos-app.vercel.app/auth/callback**
http://localhost:3000/auth/callback**
http://127.0.0.1:3000/auth/callback**
```

O sufixo `**` é obrigatório porque o app acrescenta parâmetros como `next`, `provider` e `barbearia` ao callback. Sem ele, o Supabase rejeita o destino completo e usa o `Site URL` como fallback.

Adicione `https://losbarberos.com.br/auth/callback**` apenas quando o domínio oficial estiver servindo o app.

## 3. Comportamento esperado

- Gestor novo: Google > `/auth/callback` > `/onboarding`.
- Gestor existente: Google > `/auth/callback`; os guards de membership encaminham ao gestor correto.
- Cliente existente com `client_accounts`: Google > destino original do cliente.
- Cliente novo: Google > completar cadastro > WhatsApp, nascimento e termos obrigatórios > destino original.
- A preferência transacional de WhatsApp começa ativa ao vincular o cliente ao tenant, somente quando não existe decisão anterior. Opt-out anterior nunca é sobrescrito.
- E-mails iguais e verificados podem ser vinculados automaticamente pelo Supabase; roles nunca são lidas de `user_metadata`.

## 4. Homologação mínima

1. Testar gestor novo e gestor existente.
2. Testar cliente novo e confirmar bloqueio sem WhatsApp, nascimento ou termos.
3. Testar cliente existente criado por e-mail e confirmar que o Google não duplica `client_accounts`.
4. Confirmar retorno à barbearia, barbeiro e horário originais.
5. Confirmar que um cliente com opt-out anterior continua sem consentimento.
6. Conferir ausência de erro no console e isolamento por `organization_id`.

Não é necessária migration para esta integração.
