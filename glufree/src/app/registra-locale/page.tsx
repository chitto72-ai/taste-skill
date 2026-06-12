import type { Metadata } from "next";
import RegisterWizard from "@/components/RegisterWizard";

export const metadata: Metadata = {
  title: "Registra il tuo locale",
  description:
    "Sei un ristoratore? Registra il tuo locale gluten free, invia la documentazione e ottieni il badge Verificato Glufree.",
};

export default function RegisterPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Porta il tuo locale su <span className="text-primary">Glufree</span>
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Tre passaggi, cinque minuti. La verifica della documentazione è ciò
          che rende la nostra mappa affidabile: per questo è gratuita.
        </p>
      </div>
      <RegisterWizard />
    </div>
  );
}
