import type { Metadata } from "next";
import { ProductComingSoon } from "@/components/product-coming-soon";

export const metadata: Metadata = { title: { absolute: "Acesso MusicPro — em breve | Display SH" } };

export default function MusicProLoginPage() {
  return <ProductComingSoon brand="MusicPro" audience="escolas de música" context="login" />;
}
