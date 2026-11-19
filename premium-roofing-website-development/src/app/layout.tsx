import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";

const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-bebas" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "RoofShield Pro — Premium Roofing in Austin, Texas",
  description:
    "Premium residential and commercial roofing in Austin, TX. Roof repair, replacement and inspection with transparent pricing and long-term protection.",
  openGraph: {
    title: "RoofShield Pro — Premium Roofing in Austin, Texas",
    description:
      "Premium roofing solutions engineered to protect your property and give your family lasting peace of mind.",
    images: ["/images/hero.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#080808",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // On whop.app / whop.site hosting the pixel is injected by Whop automatically.
  // Self-hosted installs load it from the snippet URL copied from the dashboard.
  const pixelSrc = process.env.NEXT_PUBLIC_WHOP_PIXEL_SRC;

  return (
    <html lang="en" className={`${bebas.variable} ${inter.variable}`}>
      <body className="bg-paper text-ink antialiased">
        {pixelSrc ? <Script src={pixelSrc} strategy="afterInteractive" /> : null}
        {children}
      </body>
    </html>
  );
}
