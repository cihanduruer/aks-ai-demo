import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "AKS AI Demo",
  description: "Forecasting + Reinforcement Learning on AKS"
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/devices", label: "Devices" },
  { href: "/jobs", label: "Jobs" },
  { href: "/results", label: "Results" },
  { href: "/cluster", label: "Cluster" },
  { href: "/technical", label: "Technical" }
];

// Set theme before paint to avoid FOUC
const themeInitScript = `(() => { try {
  const t = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (t === 'dark') document.documentElement.classList.add('dark');
} catch (e) {} })();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 border-r bg-muted/20 flex flex-col">
            <div className="h-14 flex items-center px-6 border-b">
              <Link href="/" className="font-bold tracking-tight">aks-ai-demo</Link>
            </div>
            <nav className="flex flex-col gap-1 p-4 text-sm">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  )}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto p-4 border-t flex flex-col gap-3">
              <ThemeToggle />
              <div className="text-xs text-muted-foreground">
                Chronos-2 · Stable-Baselines3 · KEDA
              </div>
            </div>
          </aside>
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
