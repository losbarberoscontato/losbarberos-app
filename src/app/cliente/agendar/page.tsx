import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking-flow";
import { ConnectedBooking } from "@/components/connected-client/booking";
import { hasSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Agendar horário" };

export default function BookingPage() {
  if (hasSupabaseConfig) return <ConnectedBooking />;
  return <BookingFlow />;
}
