import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#020408",
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://tetherverse.vercel.app"
  ),
  title: "Tetherverse",
  description:
    "One button, four parallel worlds. Hold to tether, release to launch, and climb until the multiverse gives out.",
  applicationName: "Tetherverse",
  keywords: ["climbing game", "arcade", "multiverse", "one-button"],
  openGraph: {
    type: "website",
    siteName: "Tetherverse",
    title: "Tetherverse",
    description:
      "One button, four parallel worlds. Hold to tether, release to launch, and climb until the multiverse gives out.",
    images: [{ url: "/logo.png", width: 512, height: 512, alt: "Tetherverse" }],
  },
  twitter: {
    card: "summary",
    title: "Tetherverse",
    description:
      "One button, four parallel worlds. Hold to tether, release to launch, and climb until the multiverse gives out.",
    images: ["/logo.png"],
  },
  // A game is installed, not bookmarked. Asking for the home-screen treatment
  // costs one line and is the difference between an app and a tab.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tetherverse",
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
