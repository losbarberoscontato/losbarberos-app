import type { Metadata } from "next";
import { CustomerReservations } from "@/components/customer-reservations";
import { ConnectedReservations } from "@/components/connected-client/reservations";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Minhas reservas" };

export default function CustomerReservationsPage() {
  if (hasSupabaseConfig) return <ConnectedReservations />;
  return <div className="customer-reservations-page"><CustomerReservations /></div>;
}
