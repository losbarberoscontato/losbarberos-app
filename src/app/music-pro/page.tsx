import type { Metadata } from "next";
import { ProductComingSoon } from "@/components/product-coming-soon";

export const metadata: Metadata = { title: { absolute: "MusicPro — em breve | Display SH" } };

export default function MusicProPage() {
  return <ProductComingSoon brand="MusicPro" audience="escolas de música" />;
}
