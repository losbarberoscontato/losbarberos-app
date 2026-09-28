import type { Metadata } from "next";
import { ProductComingSoon } from "@/components/product-coming-soon";

export const metadata: Metadata = { title: { absolute: "ProStetic — em breve | Display SH" } };

export default function ProSteticPage() {
  return <ProductComingSoon brand="ProStetic" audience="estética e beleza" />;
}
