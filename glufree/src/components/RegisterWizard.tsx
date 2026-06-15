"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { InviteActions } from "@/components/ShareButton";
import { AnimatePresence, motion } from "framer-motion";
import {
  Store,
  User,
  FileCheck,
  PartyPopper,
  ArrowLeft,
  ArrowRight,
  Loader2,
  ShieldCheck,
  Upload,
  Map,
} from "lucide-react";
import type { GlutenFreeLevel, PlaceCategory } from "@/lib/types";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

const CATEGORY_VALUES: PlaceCategory[] = [
  "ristorante",
  "pizzeria",
  "pasticceria",
  "gelateria",
  "bar",
  "panetteria",
];

const LEVEL_VALUES: GlutenFreeLevel[] = ["dedicated", "certified", "options"];

const PROOF_VALUES = ["aic", "menu", "training", "other"] as const;
type ProofType = (typeof PROOF_VALUES)[number];

const STEP_ICONS = [Store, User, FileCheck] as const;

interface FormState {
  name: string;
  category: PlaceCategory;
  address: string;
  city: string;
  phone: string;
  website: string;
  description: string;
  glutenFreeLevel: GlutenFreeLevel;
  fullName: string;
  email: string;
  vatNumber: string;
  proofType: ProofType;
  proofNote: string;
  proofFileName: string;
}

const initialState: FormState = {
  name: "",
  category: "ristorante",
  address: "",
  city: "",
  phone: "",
  website: "",
  description: "",
  glutenFreeLevel: "options",
  fullName: "",
  email: "",
  vatNumber: "",
  proofType: "aic",
  proofNote: "",
  proofFileName: "",
};

export default function RegisterWizard() {
  const { t } = useTranslation();
  const referral = useSearchParams().get("invito");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const r = t.register;

  const categories: { value: PlaceCategory; label: string }[] = CATEGORY_VALUES.map((value) => ({
    value,
    label: t.categories[value],
  }));
  const levels: { value: GlutenFreeLevel; label: string; help: string }[] = [
    { value: "dedicated", label: r.levelDedicated, help: r.levelDedicatedHelp },
    { value: "certified", label: r.levelCertified, help: r.levelCertifiedHelp },
    { value: "options", label: r.levelOptions, help: r.levelOptionsHelp },
  ];
  const proofs: { value: ProofType; label: string }[] = [
    { value: "aic", label: r.proofAic },
    { value: "menu", label: r.proofMenu },
    { value: "training", label: r.proofTraining },
    { value: "other", label: r.proofOther },
  ];
  const steps = [r.stepBusiness, r.stepOwner, r.stepProof];

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function validateStep(current: number): string[] {
    const errs: string[] = [];
    if (current === 0) {
      if (!form.name.trim()) errs.push(r.errName);
      if (!form.address.trim()) errs.push(r.errAddress);
      if (!form.city.trim()) errs.push(r.errCity);
      if (!form.phone.trim()) errs.push(r.errPhone);
    }
    if (current === 1) {
      if (!form.fullName.trim()) errs.push(r.errFullName);
      if (!form.email.includes("@")) errs.push(r.errEmail);
      if (!/^[0-9]{11}$/.test(form.vatNumber)) errs.push(r.errVat);
    }
    return errs;
  }

  function next() {
    const errs = validateStep(step);
    setErrors(errs);
    if (errs.length === 0) setStep((s) => s + 1);
  }

  async function submit() {
    setSubmitting(true);
    setErrors([]);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: {
            name: form.name,
            category: form.category,
            address: form.address,
            city: form.city,
            phone: form.phone,
            website: form.website || undefined,
            description: form.description,
            glutenFreeLevel: form.glutenFreeLevel,
          },
          owner: {
            fullName: form.fullName,
            email: form.email,
            vatNumber: form.vatNumber,
          },
          proof: {
            type: form.proofType,
            note: form.proofNote,
            fileName: form.proofFileName || undefined,
          },
          referral: referral || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.errors ?? [r.errGeneric]);
        return;
      }
      setDone(true);
    } catch {
      setErrors([r.errNetwork]);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl animate-fade-up rounded-3xl border border-line bg-white p-10 text-center shadow-card">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-safe-light text-safe">
          <PartyPopper className="h-8 w-8" aria-hidden />
        </span>
        <h2 className="mt-6 font-display text-2xl font-extrabold text-ink">{r.doneTitle}</h2>
        <p className="mt-3 leading-relaxed text-slate-600">
          {r.doneBody(form.fullName, form.name, form.email)}
        </p>
        <Link
          href="/mappa"
          className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-6 py-3 font-bold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Map className="h-5 w-5" aria-hidden />
          {r.doneBackToMap}
        </Link>
        <div className="mt-10 rounded-2xl bg-muted p-6 text-start">
          <p className="font-display text-lg font-bold text-ink">{r.doneInviteTitle}</p>
          <p className="mb-4 mt-1 text-sm text-slate-600">{r.doneInviteText}</p>
          <InviteActions
            message={r.doneInviteMsg}
            path="/registra-locale?invito=ristoratore"
            emailSubject={t.invite.ownerSubject}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {referral && (
        <p className="mb-6 rounded-2xl bg-safe-light px-5 py-4 text-center text-sm font-bold text-safe animate-fade-up">
          {r.referralBanner}
        </p>
      )}
      {/* Indicatore di avanzamento */}
      <ol className="mb-8 flex items-center gap-2" aria-label={r.progressAria}>
        {steps.map((label, i) => {
          const state = i < step ? "done" : i === step ? "current" : "todo";
          const Icon = STEP_ICONS[i];
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                aria-current={state === "current" ? "step" : undefined}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors duration-300 ${
                  state === "done"
                    ? "bg-safe text-white"
                    : state === "current"
                      ? "bg-primary text-white shadow-pin"
                      : "bg-muted text-slate-400"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span
                className={`hidden text-sm font-bold sm:block ${
                  state === "todo" ? "text-slate-400" : "text-ink"
                }`}
              >
                {label}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={`h-0.5 flex-1 rounded transition-colors duration-300 ${
                    i < step ? "bg-safe" : "bg-line"
                  }`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {errors.length > 0 && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
        >
          <ul className="list-inside list-disc space-y-1">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24, transition: { duration: 0.15 } }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="rounded-3xl border border-line bg-white p-6 shadow-card sm:p-8"
        >
          {step === 0 && (
            <fieldset className="space-y-5">
              <legend className="font-display text-2xl font-extrabold text-ink">
                {r.step0Legend}
              </legend>

              <Field label={r.name} htmlFor="name">
                <input
                  id="name"
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder={r.namePh}
                  autoComplete="organization"
                />
              </Field>

              <Field label={r.category} htmlFor="category">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={r.category}>
                  {categories.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={form.category === c.value}
                      onClick={() => update("category", c.value)}
                      className={`min-h-10 cursor-pointer rounded-full px-4 py-2 text-sm font-bold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        form.category === c.value
                          ? "bg-ink text-white"
                          : "bg-muted text-ink/70 hover:bg-line"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={r.address} htmlFor="address">
                  <input
                    id="address"
                    className={inputCls}
                    value={form.address}
                    onChange={(e) => update("address", e.target.value)}
                    placeholder={r.addressPh}
                    autoComplete="street-address"
                  />
                </Field>
                <Field label={r.city} htmlFor="city">
                  <input
                    id="city"
                    className={inputCls}
                    value={form.city}
                    onChange={(e) => update("city", e.target.value)}
                    placeholder={r.cityPh}
                    autoComplete="address-level2"
                  />
                </Field>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={r.phone} htmlFor="phone">
                  <input
                    id="phone"
                    type="tel"
                    className={inputCls}
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder={r.phonePh}
                    autoComplete="tel"
                  />
                </Field>
                <Field label={r.website} htmlFor="website" optional>
                  <input
                    id="website"
                    type="url"
                    className={inputCls}
                    value={form.website}
                    onChange={(e) => update("website", e.target.value)}
                    placeholder="https://…"
                    autoComplete="url"
                  />
                </Field>
              </div>

              <Field label={r.levelLabel} htmlFor="level" hint={r.levelHint}>
                <div className="space-y-2">
                  {levels.map((l) => (
                    <label
                      key={l.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors duration-200 ${
                        form.glutenFreeLevel === l.value
                          ? "border-primary bg-orange-50"
                          : "border-line hover:border-primary/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="level"
                        className="mt-1 h-4 w-4 accent-primary"
                        checked={form.glutenFreeLevel === l.value}
                        onChange={() => update("glutenFreeLevel", l.value)}
                      />
                      <span>
                        <span className="block font-bold text-ink">{l.label}</span>
                        <span className="block text-sm text-slate-500">{l.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>

              <Field label={r.description} htmlFor="description" optional>
                <textarea
                  id="description"
                  rows={3}
                  className={inputCls}
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder={r.descriptionPh}
                />
              </Field>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset className="space-y-5">
              <legend className="font-display text-2xl font-extrabold text-ink">
                {r.step1Legend}
              </legend>
              <p className="text-sm text-slate-500">{r.step1Note}</p>

              <Field label={r.fullName} htmlFor="fullName">
                <input
                  id="fullName"
                  className={inputCls}
                  value={form.fullName}
                  onChange={(e) => update("fullName", e.target.value)}
                  placeholder={r.fullNamePh}
                  autoComplete="name"
                />
              </Field>

              <Field label={r.email} htmlFor="email" hint={r.emailHint}>
                <input
                  id="email"
                  type="email"
                  className={inputCls}
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder={r.emailPh}
                  autoComplete="email"
                />
              </Field>

              <Field label={r.vat} htmlFor="vat" hint={r.vatHint}>
                <input
                  id="vat"
                  inputMode="numeric"
                  maxLength={11}
                  className={inputCls}
                  value={form.vatNumber}
                  onChange={(e) => update("vatNumber", e.target.value.replace(/\D/g, ""))}
                  placeholder="01234567890"
                />
              </Field>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset className="space-y-5">
              <legend className="font-display text-2xl font-extrabold text-ink">
                {r.step2Legend}
              </legend>
              <p className="text-sm text-slate-500">{r.step2Note}</p>

              <div className="space-y-2" role="radiogroup" aria-label={r.step2Legend}>
                {proofs.map((p) => (
                  <label
                    key={p.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors duration-200 ${
                      form.proofType === p.value
                        ? "border-safe bg-safe-light/50"
                        : "border-line hover:border-safe/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="proof"
                      className="h-4 w-4 accent-safe"
                      checked={form.proofType === p.value}
                      onChange={() => update("proofType", p.value)}
                    />
                    <span className="font-bold text-ink">{p.label}</span>
                  </label>
                ))}
              </div>

              <Field label={r.uploadLabel} htmlFor="proofFile" hint={r.uploadHint} optional>
                <label
                  htmlFor="proofFile"
                  className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-muted p-6 text-center transition-colors duration-200 hover:border-primary/50"
                >
                  <Upload className="h-6 w-6 text-primary" aria-hidden />
                  <span className="text-sm font-bold text-ink">
                    {form.proofFileName || r.uploadCta}
                  </span>
                  <input
                    id="proofFile"
                    type="file"
                    accept=".pdf,image/*"
                    className="sr-only"
                    onChange={(e) => update("proofFileName", e.target.files?.[0]?.name ?? "")}
                  />
                </label>
              </Field>

              <Field label={r.notesLabel} htmlFor="proofNote" optional>
                <textarea
                  id="proofNote"
                  rows={3}
                  className={inputCls}
                  value={form.proofNote}
                  onChange={(e) => update("proofNote", e.target.value)}
                  placeholder={r.notesPh}
                />
              </Field>

              <div className="flex items-start gap-3 rounded-2xl bg-safe-light/60 p-4 text-sm text-safe">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p>
                  {r.reassuranceA} <strong>{r.reassuranceWord}</strong> {r.reassuranceB}
                </p>
              </div>
            </fieldset>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigazione */}
      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
          className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl px-5 py-3 font-bold text-ink transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" aria-hidden />
          {r.back}
        </button>

        {step < steps.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl bg-primary px-6 py-3 font-bold text-white shadow-pin transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {r.continue}
            <ArrowRight className="h-5 w-5 rtl:rotate-180" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl bg-safe px-6 py-3 font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-safe focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                {r.submitting}
              </>
            ) : (
              <>
                <ShieldCheck className="h-5 w-5" aria-hidden />
                {r.submit}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/** Intestazione tradotta della pagina di registrazione. */
export function RegisterIntro() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
        {t.register.pageTitleA} <span className="text-primary">Glufree</span>
      </h1>
      <p className="mt-4 text-lg text-slate-600">{t.register.pageLead}</p>
    </div>
  );
}

const inputCls =
  "h-12 w-full rounded-2xl border border-line bg-white px-4 text-base placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 [&:is(textarea)]:h-auto [&:is(textarea)]:py-3";

function Field({
  label,
  htmlFor,
  hint,
  optional = false,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-bold text-ink">
        {label}
        {optional && (
          <span className="ms-2 text-xs font-semibold text-slate-400">{t.register.optional}</span>
        )}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
