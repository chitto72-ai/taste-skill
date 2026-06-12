"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin, Map, Store, Home } from "lucide-react";

const links = [
  { href: "/", label: "Home", icon: Home },
  { href: "/mappa", label: "Mappa", icon: Map },
  { href: "/registra-locale", label: "Sei un ristoratore?", icon: Store },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-[1100] h-16 border-b border-line bg-cream/90 backdrop-blur supports-[backdrop-filter]:bg-cream/75">
      <nav
        className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6"
        aria-label="Navigazione principale"
      >
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-white shadow-pin">
            <MapPin className="h-5 w-5" aria-hidden />
          </span>
          <span className="font-display text-xl font-bold tracking-tight">
            Glufree
          </span>
        </Link>

        <ul className="flex items-center gap-1 sm:gap-2">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    active
                      ? "bg-primary text-white"
                      : "text-ink/80 hover:bg-muted hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">
                    {href === "/registra-locale" ? "Ristoratori" : label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
