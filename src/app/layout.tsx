import type { Metadata, Viewport } from "next";
import { PwaSupport } from "@/components/pwa-support";
import "./globals.css";
export const metadata: Metadata = {
  title: "Relay · A little closer, even from afar",
  description:
    "A considered space for your team’s conversations, ideas, and everyday work.",
  applicationName: "Relay",
  appleWebApp: { capable: true, title: "Relay", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    icon: [
      { url: "/icons/relay.svg", type: "image/svg+xml" },
      { url: "/icons/relay-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#302845",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PwaSupport>{children}</PwaSupport>
      </body>
    </html>
  );
}
