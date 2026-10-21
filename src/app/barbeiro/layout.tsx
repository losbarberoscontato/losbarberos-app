import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "App da Equipe · Display SH" } };

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
