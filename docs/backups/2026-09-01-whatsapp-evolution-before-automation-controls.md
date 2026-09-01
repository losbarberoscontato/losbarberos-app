# Backup local — WhatsApp Evolution antes de controles de automação

- Criado em: 2026-09-01
- Base Git: `951f307`
- Escopo: estado local do módulo WhatsApp Evolution antes da implementação de controles de mensagens/T180.
- Restauração: preserve este arquivo; a partir da base indicada, aplique o patch abaixo com `git apply`.

```diff
951f307890514e6667e478706563e44f2c4d9502
 M docs/whatsapp-evolution-module.md
 M src/components/connected-manager/connected-manager.module.css
 M src/components/connected-manager/server.ts
 M src/components/connected-manager/settings-manager.tsx
 M src/components/connected-manager/whatsapp-settings.tsx
 M tests/ui/manager-connected.test.tsx
 M tests/ui/whatsapp-settings.test.tsx
warning: in the working copy of 'docs/whatsapp-evolution-module.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/components/connected-manager/connected-manager.module.css', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/components/connected-manager/server.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/components/connected-manager/settings-manager.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'src/components/connected-manager/whatsapp-settings.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'tests/ui/manager-connected.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'tests/ui/whatsapp-settings.test.tsx', LF will be replaced by CRLF the next time Git touches it
diff --git a/docs/whatsapp-evolution-module.md b/docs/whatsapp-evolution-module.md
index d828946..e2c42e3 100644
--- a/docs/whatsapp-evolution-module.md
+++ b/docs/whatsapp-evolution-module.md
@@ -2,6 +2,16 @@
 
 > Fonte técnica para manutenção do canal WhatsApp via Evolution API. Leia este documento antes de alterar agenda, lembretes, QR, webhooks, jobs ou notificações do WhatsApp.
 
+## Atualização — 01/09/2026
+
+- A página `/gestor/configuracoes/whatsapp` passou a apresentar somente o canal `Whatsapp Web API`. O módulo `Meta Cloud API` permanece no código para possível uso futuro, mas está desativado e não é renderizado nem acionável nesta superfície.
+- O hero informa: `Conecte seu Whatsapp Business, envie confirmações e lembretes de forma automática com consentimento do cliente.`
+- O card QR ocupa toda a largura disponível; etapas numeradas, aviso de infraestrutura e descrição de canal exclusivo foram ocultados conforme decisão de produto.
+- A tela conectada `/gestor/configuracoes` agora consulta `get_whatsapp_connection_status` no carregamento server-side e exibe `CONECTADO` somente quando existe conexão ativa (`is_active = true`), com estado `CONNECTED` e saúde `OK` ou não informada.
+- Quando a integração está ausente, inativa ou em estado não saudável, o card exibe `PENDENTE` e mantém o acesso à página exclusiva `/gestor/configuracoes/whatsapp`.
+- Alteração local em `src/components/connected-manager/server.ts` e `src/components/connected-manager/settings-manager.tsx`; nenhum schema, segredo, Edge Function ou infraestrutura foi alterado.
+- Testes: `tests/ui/manager-connected.test.tsx` passou `25/25`; `npm.cmd run typecheck` passou.
+
 ## Escopo e fronteiras
 
 Este módulo conecta uma conta WhatsApp Business por QR Code à **Evolution API** hospedada em VPS. É o canal `QR_WEB`, não oficial, usado para mensagens transacionais da agenda.
diff --git a/src/components/connected-manager/connected-manager.module.css b/src/components/connected-manager/connected-manager.module.css
index 8156fe9..22844c3 100644
--- a/src/components/connected-manager/connected-manager.module.css
+++ b/src/components/connected-manager/connected-manager.module.css
@@ -157,7 +157,7 @@
 .whatsappHero h1 { margin: .45rem 0 .35rem; color: inherit; font-family: var(--font-display, serif); font-size: clamp(1.55rem, 3vw, 2.2rem); }
 .whatsappHero p { max-width: 620px; margin: 0; color: #c7ded4; font-size: .9rem; }
 .whatsappEyebrow { color: #e6b45f; font-size: .7rem; font-weight: 900; letter-spacing: .12em; }
-.providerGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .85rem; }
+.providerGrid { display: grid; grid-template-columns: 1fr; gap: .85rem; }
 .providerCard { display: grid; gap: .65rem; align-content: start; padding: 1rem; border: 1px solid #e3e9e1; border-radius: 17px; background: #fbfcfa; }
 .providerCardActive { border-color: #467766; background: #f1f8f3; box-shadow: 0 0 0 2px rgb(70 119 102 / 12%); }
 .providerCardTop { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
diff --git a/src/components/connected-manager/server.ts b/src/components/connected-manager/server.ts
index d53faa3..83d07d8 100644
--- a/src/components/connected-manager/server.ts
+++ b/src/components/connected-manager/server.ts
@@ -295,11 +295,12 @@ export async function loadFinancialReportsData() {
 
 export async function loadSettingsData() {
   const { context, supabase, organizationId } = await managerClient();
-  const [organization, locations, merchant, subscription] = await Promise.all([
+  const [organization, locations, merchant, subscription, whatsappResult] = await Promise.all([
     supabase.from("organizations").select("*").eq("id", organizationId).single(),
     supabase.from("locations").select("*").eq("organization_id", organizationId).order("active", { ascending: false }),
     supabase.from("merchant_accounts").select("status,external_account_id,connected_at,token_expires_at").eq("organization_id", organizationId).eq("provider", "MERCADO_PAGO").maybeSingle(),
     supabase.from("saas_subscriptions").select("status,trial_ends_at,current_period_ends_at,grace_ends_at,retention_ends_at").eq("organization_id", organizationId).maybeSingle(),
+    supabase.rpc("get_whatsapp_connection_status", { p_organization_id: organizationId }),
   ]);
   return {
     organizationId,
@@ -308,6 +309,7 @@ export async function loadSettingsData() {
     locations: requireData(locations, "Unidade") as LocationRecord[],
     merchant: requireData(merchant, "Mercado Pago") as MerchantAccountRecord | null,
     subscription: requireData(subscription, "Assinatura") as SubscriptionRecord | null,
+    whatsapp: whatsappResult.error ? null : whatsappResult.data as WhatsAppSettingsStatus,
   };
 }
 
diff --git a/src/components/connected-manager/settings-manager.tsx b/src/components/connected-manager/settings-manager.tsx
index 6f7f253..07b183a 100644
--- a/src/components/connected-manager/settings-manager.tsx
+++ b/src/components/connected-manager/settings-manager.tsx
@@ -143,7 +143,10 @@ export function SettingsManager(props: Props) {
   }
 
   const mpConnected = props.merchant?.status === "CONNECTED";
-  const whatsappConfigured = false;
+  const whatsappConnected = props.whatsapp?.connections.some((connection) =>
+    connection.is_active && connection.status === "CONNECTED" &&
+    (!connection.health_status || connection.health_status === "OK")
+  ) ?? false;
 
   if (props.billingStatus === "CANCELED_RETENTION" || props.billingStatus === "CLOSED") {
     return <div className={styles.stack}>
@@ -209,7 +212,7 @@ export function SettingsManager(props: Props) {
       <div className={styles.list}>
         <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>Stripe Billing</strong><StatusChip active={["TRIALING", "ACTIVE", "GRACE"].includes(props.subscription?.status ?? "")} label={props.subscription?.status ?? "NÃO INICIADO"} /></span><p>Assinatura, trial, carência e cobrança geridos pelo Stripe.</p></div><Link className={`${styles.button} ${styles.buttonSoft}`} href="/regularizacao">Abrir cobrança</Link></article>
         <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>Mercado Pago</strong><StatusChip active={mpConnected} label={props.merchant?.status ?? "NÃO CONECTADO"} /></span><p>{props.merchant?.external_account_id ? `Conta ${props.merchant.external_account_id}` : "OAuth por tenant; credenciais nunca chegam ao navegador."}</p></div><button className={styles.button} type="button" onClick={connectMercadoPago} disabled={connecting}>{connecting ? "Abrindo…" : mpConnected ? "Reconectar" : "Conectar conta"}</button></article>
-        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>WhatsApp</strong><StatusChip active={whatsappConfigured} label="PENDENTE" /></span><p>Configure Meta Cloud API ou QR Web na página exclusiva da integração.</p></div><Link className={`${styles.button} ${styles.buttonSoft}`} href="/gestor/configuracoes/whatsapp">Abrir integração</Link></article>
+        <article className={styles.integration}><div className={styles.integrationInfo}><span className={styles.toolbarGroup}><strong>WhatsApp</strong><StatusChip active={whatsappConnected} label={whatsappConnected ? "CONECTADO" : "PENDENTE"} /></span><p>{whatsappConnected ? "Integração ativa para confirmações, lembretes e ações seguras." : "Configure Meta Cloud API ou QR Web na página exclusiva da integração."}</p></div><Link className={`${styles.button} ${styles.buttonSoft}`} href="/gestor/configuracoes/whatsapp">Abrir integração</Link></article>
       </div>
     </Panel>
   </div>;
diff --git a/src/components/connected-manager/whatsapp-settings.tsx b/src/components/connected-manager/whatsapp-settings.tsx
index 4676409..32cb6aa 100644
--- a/src/components/connected-manager/whatsapp-settings.tsx
+++ b/src/components/connected-manager/whatsapp-settings.tsx
@@ -301,14 +301,14 @@ export function WhatsAppSettings({ organizationId, organizationName, status, sch
       <div>
         <span className={styles.whatsappEyebrow}>INTEGRAÇÃO POR BARBEARIA</span>
         <h1 id="whatsapp-title">WhatsApp da sua operação</h1>
-        <p>Escolha um canal, acompanhe a conexão e envie confirmações e lembretes com consentimento do cliente.</p>
+        <p>Conecte seu Whatsapp Business, envie confirmações e lembretes de forma automática com consentimento do cliente.</p>
       </div>
       <StatusChip active={activeConnectionHealthy} label={checkingStatus ? "VERIFICANDO…" : activeConnectionHealthy ? "CONECTADO" : "AÇÃO NECESSÁRIA"} />
     </section>
 
-    <Panel title="Escolha como conectar" description="Apenas um canal fica ativo por vez. As credenciais ficam protegidas no servidor e no Vault.">
+    <Panel title="Escolha como conectar">
       <div className={styles.providerGrid}>
-        {(["META_CLOUD", "QR_WEB"] as const).map((provider) => {
+        {(["QR_WEB"] as Array<"META_CLOUD" | "QR_WEB">).map((provider) => {
           const connection = connectionByProvider.get(provider);
           const isMeta = provider === "META_CLOUD";
           return <article className={`${styles.providerCard} ${connection?.is_active ? styles.providerCardActive : ""}`} key={provider}>
@@ -316,7 +316,7 @@ export function WhatsAppSettings({ organizationId, organizationName, status, sch
               <div className={styles.providerIcon}>{isMeta ? "M" : "QR"}</div>
               <StatusChip active={connection?.status === "CONNECTED" && (!connection.health_status || connection.health_status === "OK")} label={checkingStatus && connection?.provider === "QR_WEB" ? "VERIFICANDO…" : connectionLabel(connection)} />
             </div>
-            <h3>{providerLabels[provider]}</h3>
+            <h3>{provider === "QR_WEB" ? "Whatsapp Web API" : providerLabels[provider]}</h3>
             <p>{isMeta ? "Canal oficial da Meta, com Embedded Signup e templates aprovados." : "Gateway Evolution API em VPS dedicado. Canal não oficial, sujeito a restrições do WhatsApp."}</p>
             {connection?.phone_number_id && <small>Phone Number ID: {connection.phone_number_id}</small>}
             {connection?.gateway_instance_id && <small>Instância: {connection.gateway_instance_id}</small>}
@@ -338,11 +338,6 @@ export function WhatsAppSettings({ organizationId, organizationName, status, sch
           </article>;
         })}
       </div>
-      <div className={styles.whatsappSteps} aria-label="Etapas da conexão">
-        <span><strong>1</strong> Escolha o canal</span>
-        <span><strong>2</strong> Autorize a conexão</span>
-        <span><strong>3</strong> Aguarde a confirmação</span>
-      </div>
       <div className={`${styles.message} ${qrDiagnostic.warning ? styles.warning : ""}`} role="status">
         <strong>{qrDiagnostic.title}</strong><br />{qrDiagnostic.body}
         {checkingStatus && <span className={styles.statusProgress}><span className={styles.spinner} aria-hidden="true" /> Verificando conexão automaticamente…</span>}
@@ -352,7 +347,6 @@ export function WhatsAppSettings({ organizationId, organizationName, status, sch
         <div><strong>Escaneie com o WhatsApp Business</strong><p>Abra Aparelhos conectados no celular do gestor e leia este código.</p></div>
         <img src={visibleQrCode.startsWith("data:") ? visibleQrCode : `data:image/png;base64,${visibleQrCode}`} alt="QR Code temporário para conectar o WhatsApp" />
       </div>}
-      <p className={styles.providerNotice}>O QR Web exige VPS e manutenção do gateway. A Meta Cloud API exige configuração de aplicativo, WABA, templates e credenciais server-side.</p>
     </Panel>
 
     <Panel title="Avisos do gestor" description="Receba solicitações de atendimento do cliente em um WhatsApp separado da conta conectada ao QR.">
diff --git a/tests/ui/manager-connected.test.tsx b/tests/ui/manager-connected.test.tsx
index 2fa583e..4916471 100644
--- a/tests/ui/manager-connected.test.tsx
+++ b/tests/ui/manager-connected.test.tsx
@@ -5,6 +5,7 @@ import { CustomersManager } from "@/components/connected-manager/customers-manag
 import { ManagerDashboard } from "@/components/connected-manager/manager-dashboard";
 import { SettingsManager } from "@/components/connected-manager/settings-manager";
 import { TeamManager } from "@/components/connected-manager/team-manager";
+import type { WhatsAppSettingsStatus } from "@/components/connected-manager/whatsapp-settings";
 
 const refresh = vi.fn();
 const mutationMocks = vi.hoisted(() => ({ update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })) })) }));
@@ -32,6 +33,17 @@ const organization = {
 const customer = { id: "customer-1", organization_id: "org-1", auth_user_id: null, full_name: "Cliente Real", phone_e164: "+5511999999999", email: null, birth_date: null, notes: null, active: true, inactivation_reason: null, inactivated_at: null, created_at: new Date().toISOString() };
 const barber = { id: "barber-1", organization_id: "org-1", location_id: "location-1", display_name: "Barbeiro Real", bio: null, avatar_url: null, whatsapp_e164: null, active: true };
 const service = { id: "service-1", organization_id: "org-1", name: "Corte Real", description: null, price_cents: 5000, duration_minutes: 30, active: true, sort_order: 0, audiences: ["MASCULINO"] as const };
+const connectedWhatsapp: WhatsAppSettingsStatus = {
+  connections: [{
+    id: "whatsapp-1", provider: "QR_WEB", status: "CONNECTED", is_active: true,
+    waba_id: null, phone_number_id: null, gateway_instance_id: "lb-test",
+    connected_at: "2026-09-01T10:00:00Z", disconnected_at: null, last_error_code: null,
+    last_status_at: "2026-09-01T10:00:00Z", health_status: "OK",
+  }],
+  managerNotification: { phoneE164: null, matchesQrPhone: false },
+  reminders: [],
+  automation: { confirmation_enabled: true, confirmation_template_key: "appointment_confirmation", welcome_enabled: true, welcome_message: "" },
+};
 
 function renderTeam() {
   return render(<TeamManager
@@ -115,6 +127,7 @@ describe("connected manager UI", () => {
       locations={[]}
       merchant={null}
       subscription={null}
+      whatsapp={null}
     />);
 
     const sheet = screen.getByLabelText("Folha de impressão da fila presencial");
@@ -133,6 +146,7 @@ describe("connected manager UI", () => {
       locations={[]}
       merchant={null}
       subscription={null}
+      whatsapp={null}
     />);
 
     expect(screen.queryByLabelText("Sinal (%)")).not.toBeInTheDocument();
@@ -140,6 +154,40 @@ describe("connected manager UI", () => {
     expect(screen.queryByLabelText("Duração do hold")).not.toBeInTheDocument();
   });
 
+  it("exibe WhatsApp conectado quando há canal ativo e saudável", () => {
+    render(<SettingsManager
+      organizationId="org-1"
+      billingStatus="ACTIVE"
+      organization={organization}
+      locations={[]}
+      merchant={null}
+      subscription={null}
+      whatsapp={connectedWhatsapp}
+    />);
+
+    expect(screen.getByText("CONECTADO")).toBeInTheDocument();
+    expect(screen.getByText("Integração ativa para confirmações, lembretes e ações seguras.")).toBeInTheDocument();
+    expect(screen.queryByText("PENDENTE")).not.toBeInTheDocument();
+  });
+
+  it("retorna WhatsApp para pendente quando canal conectado está inativo", () => {
+    render(<SettingsManager
+      organizationId="org-1"
+      billingStatus="ACTIVE"
+      organization={organization}
+      locations={[]}
+      merchant={null}
+      subscription={null}
+      whatsapp={{
+        ...connectedWhatsapp,
+        connections: [{ ...connectedWhatsapp.connections[0], is_active: false }],
+      }}
+    />);
+
+    expect(screen.getByText("PENDENTE")).toBeInTheDocument();
+    expect(screen.getByText("Configure Meta Cloud API ou QR Web na página exclusiva da integração.")).toBeInTheDocument();
+  });
+
   it("blocks only new booking and rescheduling while existing operations stay visible", () => {
     const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
     const futureStart = new Date(`${today}T14:00:00-03:00`);
diff --git a/tests/ui/whatsapp-settings.test.tsx b/tests/ui/whatsapp-settings.test.tsx
index 393ca61..e75e67d 100644
--- a/tests/ui/whatsapp-settings.test.tsx
+++ b/tests/ui/whatsapp-settings.test.tsx
@@ -39,13 +39,18 @@ const status: WhatsAppSettingsStatus = {
 };
 
 describe("WhatsApp settings", () => {
-  it("exibe conexão híbrida por provedor e automações transacionais", () => {
+  it("exibe somente WhatsApp Web e automações transacionais", () => {
     render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);
 
     expect(screen.getByRole("heading", { name: "WhatsApp" })).toBeInTheDocument();
-    expect(screen.getByText("Meta Cloud API")).toBeInTheDocument();
-    expect(screen.getByText("QR Web")).toBeInTheDocument();
-    expect(screen.getByText(/um canal fica ativo por vez/i)).toBeInTheDocument();
+    expect(screen.getByText("Whatsapp Web API")).toBeInTheDocument();
+    expect(screen.queryByText("Meta Cloud API")).not.toBeInTheDocument();
+    expect(screen.queryByText(/um canal fica ativo por vez/i)).not.toBeInTheDocument();
+    expect(screen.queryByText("Escolha o canal")).not.toBeInTheDocument();
+    expect(screen.queryByText("Autorize a conexão")).not.toBeInTheDocument();
+    expect(screen.queryByText("Aguarde a confirmação")).not.toBeInTheDocument();
+    expect(screen.queryByText(/O QR Web exige VPS/i)).not.toBeInTheDocument();
+    expect(screen.getByText(/Conecte seu Whatsapp Business/i)).toBeInTheDocument();
     expect(screen.getByText("Confirmação do agendamento")).toBeInTheDocument();
     expect(screen.getByText("Lembrete 6 horas antes")).toBeInTheDocument();
     expect(screen.getByText("Lembrete 45 minutos antes")).toBeInTheDocument();
@@ -56,7 +61,7 @@ describe("WhatsApp settings", () => {
     render(<WhatsAppSettings organizationId="org-1" organizationName="Barbearia Central" status={status} />);
 
     expect(screen.queryByLabelText(/token|secret|senha/i)).not.toBeInTheDocument();
-    expect(screen.getAllByText(/credenciais ficam protegidas no servidor/i).length).toBeGreaterThan(0);
+    expect(screen.getByText(/Não inclua tokens ou dados sensíveis/i)).toBeInTheDocument();
   });
 
   it("oferece atualizar status e lifecycle do canal conectado", () => {

```

