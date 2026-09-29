import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "Le Gras", template: "%s · Le Gras" },
  description: "Gestão para estúdios fotográficos: organize clientes, agenda e projetos em um só espaço.",
  applicationName: "Le Gras",
  appleWebApp: {
    capable: true,
    title: "Le Gras",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/le-gras/icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f0f7" },
    { media: "(prefers-color-scheme: dark)", color: "#29143d" },
  ],
};

export default function LeGrasLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
