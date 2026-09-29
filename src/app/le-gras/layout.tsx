import type { Metadata } from "next";

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/le-gras/icon.svg", type: "image/svg+xml" }],
  },
};

export default function LeGrasLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
