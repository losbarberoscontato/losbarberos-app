import { redirect } from "next/navigation";

export default async function PublicBarbershopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(slug)) {
    redirect(`/cliente/entrar?booking=${encodeURIComponent(slug)}`);
  }
  redirect(`/cliente/entrar?barbearia=${encodeURIComponent(slug)}`);
}
