import type { Metadata } from "next";
import { ProductComingSoon } from "@/components/product-coming-soon";

export const metadata: Metadata = { title: { absolute: "Acesso ProStetic — em breve | Display SH" } };

export default function ProSteticLoginPage() {
  return <ProductComingSoon brand="ProStetic" audience="estética e beleza" context="login" />;
}
