import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { Ambient } from "@/components/Ambient";
import { Providers } from "@/components/Providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "Lexa",
  description:
    "Transcription, loanword, and code-switching annotation for linguistic fieldwork. Created by Emma Cehic.",
  applicationName: "Lexa",
  authors: [{ name: "Emma Cehic" }],
  creator: "Emma Cehic",
  publisher: "Emma Cehic",
};

export const viewport: Viewport = {
  themeColor: "#EDEFF3",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Applies the stored light/dark choice before first paint. Default is light;
 * the OS preference is not consulted.
 */
const THEME_SCRIPT = `try{document.documentElement.setAttribute("data-theme",localStorage.getItem("lexa.theme")==="dark"?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}`;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script
          id="lexa-theme"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
        <Ambient />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
