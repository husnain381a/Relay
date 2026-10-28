import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Relay · A little closer, even from afar",
  description:
    "A considered space for your team’s conversations, ideas, and everyday work.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
