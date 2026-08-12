import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { publicSite } from "@/lib/public-site";

export const metadata: Metadata = {
  metadataBase: new URL(publicSite.origin),
  title: {
    default: "Los Barberos · Gestão para barbearias",
    template: "%s · Los Barberos",
  },
  description: "Agenda, clientes, pagamentos e crescimento da sua barbearia em um só lugar.",
  applicationName: "Los Barberos",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Los Barberos",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3eb" },
    { media: "(prefers-color-scheme: dark)", color: "#102d27" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
