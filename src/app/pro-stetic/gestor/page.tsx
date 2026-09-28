import type { Metadata } from "next";
import { ProductComingSoon } from "@/components/product-coming-soon";

export const metadata: Metadata = { title: { absolute: "Painel ProStetic — em breve | Display SH" } };

export default function ProSteticManagerPage() {
  return <ProductComingSoon brand="ProStetic" audience="estética e beleza" context="manager" />;
}
