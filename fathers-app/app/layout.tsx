import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seven Dads, One Family",
  description: "A private Father’s Day tribute, told through the photographs and memories of one family.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-AU">
      <body className="antialiased">{children}</body>
    </html>
  );
}
