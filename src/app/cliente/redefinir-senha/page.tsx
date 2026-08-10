import type { Metadata } from "next";
import { ClientPasswordResetForm } from "@/components/connected-client/auth-form";
import { clientAuthDestination } from "@/lib/client-auth";

export const metadata: Metadata = { title: "Redefinir senha" };

type PasswordResetSearchParams = Promise<{
  code?: string | string[];
  sb_flow_id?: string | string[];
  barbearia?: string | string[];
}>;

export default async function ClientPasswordResetPage({
  searchParams,
}: {
  searchParams: PasswordResetSearchParams;
}) {
  const input = await searchParams;
  const hasAmbiguousRecoveryContext = Array.isArray(input.code)
    || Array.isArray(input.sb_flow_id)
    || Array.isArray(input.barbearia);
  const slug = typeof input.barbearia === "string" ? input.barbearia : null;
  const recoveryCode = !hasAmbiguousRecoveryContext
    && typeof input.code === "string"
    && input.code.length > 0
    ? input.code
    : null;
  const recoveryFlowId = typeof input.sb_flow_id === "string" && input.sb_flow_id.length > 0
    ? input.sb_flow_id
    : null;
  const destination = clientAuthDestination({ next: "/cliente", slug });
  const resolved = new URL(destination, "https://cliente.local");

  return (
    <ClientPasswordResetForm
      initialSlug={resolved.searchParams.get("barbearia")}
      recoveryCode={recoveryCode}
      recoveryFlowId={recoveryFlowId}
    />
  );
}
