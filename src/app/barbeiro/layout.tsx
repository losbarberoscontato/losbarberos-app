import type { Metadata } from "next";

export const metadata: Metadata = { title: "App do Barbeiro" };

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
