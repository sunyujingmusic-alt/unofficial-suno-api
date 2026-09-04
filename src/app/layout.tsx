import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { Analytics } from "@vercel/analytics/react"

export const metadata: Metadata = {
  title: "Suno API Final",
  description: "Minimal Suno HTTP runtime for the currently verified create, poll, and download path.",
  keywords: ["suno", "suno api", "suno.ai", "api", "music", "generation", "ai", "v5"],
  creator: "@gcui.ai",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans overflow-y-scroll">
        <Header />
        <main className="flex flex-col items-center m-auto w-full">
          {children}
        </main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
