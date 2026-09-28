import { countryFromBcp47 } from "./countries";
import { FLAG_ICON_CODES } from "./flag-icon-codes";

/**
 * Representative flag-icons code for each Whisper ISO 639-1 language.
 * Language codes are not country codes — `countryFromBcp47("en")` used to
 * return Australia, and many languages had no match (blank white box).
 */
const LANGUAGE_FLAG: Record<string, string> = {
  af: "za",
  am: "et",
  ar: "arab",
  as: "in",
  az: "az",
  ba: "ru",
  be: "by",
  bg: "bg",
  bn: "bd",
  bo: "cn",
  br: "fr",
  bs: "ba",
  ca: "es-ct",
  cs: "cz",
  cy: "gb-wls",
  da: "dk",
  de: "de",
  el: "gr",
  en: "gb",
  es: "es",
  et: "ee",
  eu: "es-pv",
  fa: "ir",
  fi: "fi",
  fo: "fo",
  fr: "fr",
  gl: "es",
  gu: "in",
  ha: "ng",
  haw: "us",
  he: "il",
  hi: "in",
  hr: "hr",
  ht: "ht",
  hu: "hu",
  hy: "am",
  id: "id",
  is: "is",
  it: "it",
  ja: "jp",
  jw: "id",
  ka: "ge",
  kk: "kz",
  km: "kh",
  kn: "in",
  ko: "kr",
  la: "eu",
  lb: "lu",
  ln: "cd",
  lo: "la",
  lt: "lt",
  lv: "lv",
  mg: "mg",
  mi: "nz",
  mk: "mk",
  ml: "in",
  mn: "mn",
  mr: "in",
  ms: "my",
  mt: "mt",
  my: "mm",
  ne: "np",
  nl: "nl",
  nn: "no",
  no: "no",
  oc: "fr",
  pa: "in",
  pl: "pl",
  ps: "af",
  pt: "pt",
  ro: "ro",
  ru: "ru",
  sa: "in",
  sd: "pk",
  si: "lk",
  sk: "sk",
  sl: "si",
  sn: "zw",
  so: "so",
  sq: "al",
  sr: "rs",
  su: "id",
  sv: "se",
  sw: "tz",
  ta: "lk",
  te: "in",
  tg: "tj",
  th: "th",
  tk: "tm",
  tl: "ph",
  tr: "tr",
  tt: "ru",
  uk: "ua",
  ur: "pk",
  uz: "uz",
  vi: "vn",
  yi: "il",
  yo: "ng",
  zh: "cn",
};

/** flag-icons CSS class suffix (e.g. `de`, `gb-wls`, `arab`). */
export function flagForLanguage(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return "un";

  const parts = normalized.split("-");
  const region = parts[1]?.toLowerCase();
  if (region && /^[a-z]{2}$/.test(region)) {
    const fromRegion = countryFromBcp47(normalized);
    if (fromRegion && FLAG_ICON_CODES.has(fromRegion)) return fromRegion;
  }

  const lang = parts[0].toLowerCase();
  if (LANGUAGE_FLAG[lang]) {
    const mapped = LANGUAGE_FLAG[lang];
    if (FLAG_ICON_CODES.has(mapped)) return mapped;
  }

  const fallback = countryFromBcp47(normalized);
  if (fallback && FLAG_ICON_CODES.has(fallback)) return fallback;
  return "un";
}

export function languageFlagClass(tag: string): string {
  return `fi fi-${flagForLanguage(tag)} fis`;
}
