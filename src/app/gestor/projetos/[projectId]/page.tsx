import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { hasSupabaseConfig } from "@/lib/env";
import { ProjectsManager } from "@/components/connected-manager/projects-manager";
import { loadProjectsData } from "@/components/connected-manager/projects-server";
import { EmptyState, Panel } from "@/components/connected-manager/shared";
import styles from "@/components/connected-manager/connected-manager.module.css";

export const metadata: Metadata = { title: "Projeto" };

async function loadProjectDetail() {
  try {
    const data = await loadProjectsData();
    return { data, error: "" };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Não foi possível carregar o módulo Projetos." };
  }
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!hasSupabaseConfig) notFound();

  const result = await loadProjectDetail();
  if (result.error) {
    if (result.error.includes("Sessão de gestor inválida")) redirect(`/entrar?next=/gestor/projetos/${projectId}`);
    return <div className={styles.stack}><PageHeader title="Projeto" description="O módulo está conectado ao Supabase, mas a estrutura operacional ainda precisa estar aplicada." /><Panel title="Migration pendente" description="Nenhuma alteração remota foi executada automaticamente."><EmptyState title="Banco ainda não preparado">{result.error}. A migration local gerada para esta etapa precisa ser aplicada ao banco de teste antes de criar dados.</EmptyState></Panel></div>;
  }

  const data = result.data;
  if (!data) notFound();
  if (!data.enabled) {
    return <div className={styles.stack}><PageHeader title="Projetos" description="O módulo organiza ofertas comerciais, contratações e etapas de execução." /><Panel title="Módulo inativo" description="Ative Projetos em Configurações → Módulos para começar."><EmptyState title="Projetos ainda não está ativo">A ativação exige aceite do aditivo contratual e passa a valer no próximo ciclo de cobrança.</EmptyState></Panel></div>;
  }
  if (!data.projects.some((project) => project.id === projectId)) notFound();
  return <ProjectsManager {...data} projectId={projectId} />;
}
