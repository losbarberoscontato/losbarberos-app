import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  applicationName: "ProStetic",
  appleWebApp: { capable: true, title: "ProStetic", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#4d245f" };

export default function ProSteticLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
