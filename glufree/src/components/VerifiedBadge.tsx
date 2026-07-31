"use client";

import { BadgeCheck, ShieldCheck, Users, Clock, Sparkles } from "lucide-react";
import type { GlutenFreeLevel, VerificationStatus } from "@/lib/types";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

/** Inserzione a pagamento: badge deliberatamente distinto da quello di sicurezza. */
export function FeaturedBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-amber-950"
      title={t.badges.featured}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      {t.badges.featured}
    </span>
  );
}

export function LevelBadge({ level }: { level: GlutenFreeLevel }) {
  const { t } = useTranslation();
  if (level === "dedicated") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-safe-light px-2.5 py-1 text-xs font-bold text-safe">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        {t.badges.dedicated}
      </span>
    );
  }
  if (level === "certified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-accent">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
        {t.badges.certified}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-primary-dark">
      {t.badges.options}
    </span>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation();
  if (status === "verified") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white"
        title={t.badges.verified}
      >
        <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
        {t.badges.verified}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {t.badges.pending}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
      <Users className="h-3.5 w-3.5" aria-hidden />
      {t.badges.community}
    </span>
  );
}
