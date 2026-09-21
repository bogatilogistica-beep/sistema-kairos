import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bogati Rutas — Logística Inteligente",
  description: "Optimización de rutas y costos logísticos para HELADO, QUESO y CREMA",
};

const NAV = [
  { href: "/", label: "Panel" },
  { href: "/optimizar", label: "Optimizar semana" },
  { href: "/red", label: "Red de PDV" },
  { href: "/config", label: "Configuración" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="bg-bogati-brown text-white">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight">bogati</span>
                <span className="text-sm text-bogati-orange font-medium">rutas</span>
              </div>
              <nav className="flex gap-1">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>
          <footer className="text-center text-xs text-bogati-brown/60 py-4">
            Concurso Interno de IA — Bogati Sabor Adictivo S.A.S.
          </footer>
        </div>
      </body>
    </html>
  );
}
