import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { ensureReady } from "@/lib/ready";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Bakeshop", template: "%s · Bakeshop" },
  description: "Inventory, recipes, purchases, and sales for a small bakeshop.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f6f3",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  ensureReady();
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
