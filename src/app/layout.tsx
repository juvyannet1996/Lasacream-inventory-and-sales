import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { ensureReady } from "@/lib/ready";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lasacream", template: "%s · Lasacream" },
  description: "Inventory, recipes, purchases, and sales for Lasacream.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f6f3",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureReady();
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
