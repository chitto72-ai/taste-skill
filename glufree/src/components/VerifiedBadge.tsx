import { BadgeCheck, ShieldCheck, Users, Clock } from "lucide-react";
import type { GlutenFreeLevel, VerificationStatus } from "@/lib/types";

export function LevelBadge({ level }: { level: GlutenFreeLevel }) {
  if (level === "dedicated") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-safe-light px-2.5 py-1 text-xs font-bold text-safe">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        100% Gluten Free
      </span>
    );
  }
  if (level === "certified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-accent">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
        Certificato AIC
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-primary-dark">
      Menu GF dedicato
    </span>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  if (status === "verified") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white"
        title="Documentazione controllata dal team Glufree"
      >
        <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
        Verificato Glufree
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        Verifica in corso
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
      <Users className="h-3.5 w-3.5" aria-hidden />
      Segnalato dalla community
    </span>
  );
}
