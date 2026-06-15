import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import Sidebar from "@/components/Sidebar";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "opsz"],
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: "HealthTrack",
  description: "Your body, beautifully measured.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b0d0f",
};

// Applies the saved theme before first paint to avoid a flash.
const themeInit = `(function(){try{var t=localStorage.getItem("ht-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${fraunces.variable} ${instrument.variable}`}>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <div className="shell">
          <Sidebar />
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
