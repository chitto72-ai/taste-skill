"use client";

import { useState } from "react";
import { Share2, Check, Copy } from "lucide-react";

interface ShareButtonProps {
  title: string;
  text: string;
  /** Percorso relativo (es. /mappa?locale=abc): l'origine viene aggiunta a runtime */
  path: string;
  label?: string;
  className?: string;
}

/** Condivisione nativa (Web Share API) con fallback "copia link". */
export default function ShareButton({
  title,
  text,
  path,
  label = "Condividi",
  className = "",
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function share(e: React.MouseEvent) {
    e.stopPropagation();
    const url = `${window.location.origin}${path}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        /* condivisione annullata dall'utente: nessun errore da mostrare */
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        /* clipboard non disponibile */
      }
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
      aria-live="polite"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4 text-safe" aria-hidden />
          Link copiato!
        </>
      ) : (
        <>
          <Share2 className="h-4 w-4" aria-hidden />
          {label}
        </>
      )}
    </button>
  );
}

/** Pulsanti di invito: WhatsApp, email e link da copiare. */
export function InviteActions({
  message,
  path,
  emailSubject,
}: {
  message: string;
  path: string;
  emailSubject: string;
}) {
  const [copied, setCopied] = useState(false);

  function fullUrl() {
    return `${window.location.origin}${path}`;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href="#whatsapp"
        onClick={(e) => {
          e.preventDefault();
          window.open(
            `https://wa.me/?text=${encodeURIComponent(`${message} ${fullUrl()}`)}`,
            "_blank",
            "noopener"
          );
        }}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2 text-sm font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2"
      >
        <WhatsAppIcon className="h-4 w-4" />
        WhatsApp
      </a>
      <a
        href="#email"
        onClick={(e) => {
          e.preventDefault();
          window.location.href = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(`${message}\n\n${fullUrl()}`)}`;
        }}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
      >
        <MailIcon className="h-4 w-4" />
        Email
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${message} ${fullUrl()}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            /* clipboard non disponibile */
          }
        }}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-live="polite"
      >
        {copied ? (
          <>
            <Check className="h-4 w-4 text-safe" aria-hidden />
            Copiato!
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" aria-hidden />
            Copia link
          </>
        )}
      </button>
    </div>
  );
}

function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.86 9.86 0 0 0 12.04 2zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29z" />
    </svg>
  );
}

function MailIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
