import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { ProjectsManager } from "@/components/connected-manager/projects-manager";
import { loadProjectsData } from "@/components/connected-manager/projects-server";
import { EmptyState, Panel } from "@/components/connected-manager/shared";
import styles from "@/components/connected-manager/connected-manager.module.css";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjectsPage() {
  if (!hasSupabaseConfig) {
    return <div className={styles.stack}><PageHeader title="Projetos" description="Configure o Supabase para usar o módulo Projetos com dados reais." /><Panel title="Conexão necessária" description="O modo demonstração não cria projetos locais neste módulo."><EmptyState title="Supabase não configurado">Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no ambiente local.</EmptyState></Panel></div>;
  }

  try {
    const data = await loadProjectsData();
    if (!data.enabled) {
      return <div className={styles.stack}><PageHeader title="Projetos" description="O módulo organiza ofertas comerciais, contratações e etapas de execução." /><Panel title="Módulo inativo" description="Ative Projetos em Configurações → Módulos para começar."><EmptyState title="Projetos ainda não está ativo">A ativação exige aceite do aditivo contratual e passa a valer no próximo ciclo de cobrança.</EmptyState></Panel></div>;
    }
    return <ProjectsManager {...data} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar o módulo Projetos.";
    if (message.includes("Sessão de gestor inválida")) redirect("/entrar?next=/gestor/projetos");
    return <div className={styles.stack}><PageHeader title="Projetos" description="O módulo está conectado ao Supabase, mas a estrutura operacional ainda precisa estar aplicada." /><Panel title="Migration pendente" description="Nenhuma alteração remota foi executada automaticamente."><EmptyState title="Banco ainda não preparado">{message}. A migration local gerada para esta etapa precisa ser aplicada ao banco de teste antes de criar dados.</EmptyState></Panel></div>;
  }
}
