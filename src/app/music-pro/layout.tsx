import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  applicationName: "MusicPro",
  appleWebApp: { capable: true, title: "MusicPro", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#06233b",
};

export default function MusicProLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
