"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { LANGUAGES } from "@/lib/i18n/config";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

export default function LanguageSwitcher() {
  const { lang, setLang, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Chiude il menu cliccando fuori o premendo Esc.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.langLabel}
        className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold text-ink/80 transition-colors duration-200 hover:bg-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Globe className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">{current.code.toUpperCase()}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t.langLabel}
          className="absolute end-0 mt-2 w-44 overflow-hidden rounded-2xl border border-line bg-white py-1 shadow-card"
        >
          {LANGUAGES.map((l) => {
            const active = l.code === lang;
            return (
              <li key={l.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setLang(l.code);
                    setOpen(false);
                  }}
                  className={`flex w-full min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-sm font-semibold transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:bg-muted ${
                    active ? "text-primary" : "text-ink"
                  }`}
                >
                  <span className="text-lg leading-none" aria-hidden>
                    {l.flag}
                  </span>
                  <span className="flex-1 text-start">{l.label}</span>
                  {active && <Check className="h-4 w-4 text-primary" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
