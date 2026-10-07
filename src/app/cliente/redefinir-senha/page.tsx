import type { Metadata } from "next";
import { ClientPasswordResetForm } from "@/components/connected-client/auth-form";
import { clientAuthDestination } from "@/lib/client-auth";
import { clientEntryMetadata } from "@/lib/client-entry-metadata";


type PasswordResetSearchParams = Promise<{
  code?: string | string[];
  sb_flow_id?: string | string[];
  barbearia?: string | string[];
  booking?: string | string[];
}>;

export async function generateMetadata({ searchParams }: { searchParams: PasswordResetSearchParams }): Promise<Metadata> {
  const input = await searchParams;
  return clientEntryMetadata({
    next: "/cliente",
    slug: typeof input.barbearia === "string" ? input.barbearia : null,
    booking: typeof input.booking === "string" ? input.booking : null,
  });
}

export default async function ClientPasswordResetPage({
  searchParams,
}: {
  searchParams: PasswordResetSearchParams;
}) {
  const input = await searchParams;
  const hasAmbiguousRecoveryContext = Array.isArray(input.code)
    || Array.isArray(input.sb_flow_id)
    || Array.isArray(input.barbearia)
    || Array.isArray(input.booking);
  const slug = typeof input.barbearia === "string" ? input.barbearia : null;
  const booking = typeof input.booking === "string" ? input.booking : null;
  const recoveryCodeInput = !hasAmbiguousRecoveryContext
    && typeof input.code === "string"
    && input.code.length > 0
    ? input.code
    : null;
  const recoveryFlowIdInput = !hasAmbiguousRecoveryContext
    && typeof input.sb_flow_id === "string"
    && input.sb_flow_id.length > 0
    ? input.sb_flow_id
    : null;
  const recoveryCode = recoveryCodeInput && recoveryFlowIdInput ? recoveryCodeInput : null;
  const recoveryFlowId = recoveryCodeInput && recoveryFlowIdInput ? recoveryFlowIdInput : null;
  const destination = clientAuthDestination({ next: "/cliente", slug, booking });
  const resolved = new URL(destination, "https://cliente.local");

  return (
    <ClientPasswordResetForm
      initialSlug={resolved.searchParams.get("barbearia")}
      initialBooking={resolved.searchParams.get("booking")}
      recoveryCode={recoveryCode}
      recoveryFlowId={recoveryFlowId}
    />
  );
}
