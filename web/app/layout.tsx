import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://crosstown.jongschaf.com"),
  title: {
    default: "Crosstown - Columbus bus reliability, measured",
    template: "%s - Crosstown",
  },
  description:
    "Every COTA bus in Columbus on a live map, plus reliability stats built from a growing archive of real arrival data.",
  openGraph: {
    title: "Crosstown",
    description: "Live COTA bus map and reliability stats for Columbus, Ohio.",
    url: "https://crosstown.jongschaf.com",
    siteName: "Crosstown",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
