import { redirect } from "next/navigation";

export default async function PublicBarbershopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/cliente?barbearia=${encodeURIComponent(slug)}`);
}
