export const LANGUAGES = [
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANG: Lang = "it";

/** Lingue che si leggono da destra a sinistra. */
export const RTL_LANGS: Lang[] = ["ar"];

export const STORAGE_KEY = "glufree-lang";

export function isLang(value: string | null | undefined): value is Lang {
  return !!value && LANGUAGES.some((l) => l.code === value);
}

/** Deduce la lingua iniziale dal browser, con fallback all'italiano. */
export function detectLang(): Lang {
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  const prefix = navigator.language?.slice(0, 2).toLowerCase();
  return isLang(prefix) ? prefix : DEFAULT_LANG;
}
