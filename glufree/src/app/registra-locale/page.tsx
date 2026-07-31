import type { Metadata } from "next";
import { Suspense } from "react";
import RegisterWizard, { RegisterIntro } from "@/components/RegisterWizard";

export const metadata: Metadata = {
  title: "Registra il tuo locale",
  description:
    "Sei un ristoratore? Registra il tuo locale gluten free, invia la documentazione e ottieni il badge Verificato Glufree.",
};

export default function RegisterPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
      <RegisterIntro />
      <Suspense>
        <RegisterWizard />
      </Suspense>
    </div>
  );
}
