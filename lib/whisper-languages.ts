/**
 * Languages Whisper actually transcribes. Source: openai/whisper tokenizer
 * `LANGUAGES` (99 ISO 639-1 tags). Display names are title-cased English.
 */

export interface WhisperLanguage {
  code: string;
  name: string;
}

export const WHISPER_LANGUAGES: WhisperLanguage[] = [
  { code: "af", name: "Afrikaans" },
  { code: "am", name: "Amharic" },
  { code: "ar", name: "Arabic" },
  { code: "as", name: "Assamese" },
  { code: "az", name: "Azerbaijani" },
  { code: "ba", name: "Bashkir" },
  { code: "be", name: "Belarusian" },
  { code: "bg", name: "Bulgarian" },
  { code: "bn", name: "Bengali" },
  { code: "bo", name: "Tibetan" },
  { code: "br", name: "Breton" },
  { code: "bs", name: "Bosnian" },
  { code: "ca", name: "Catalan" },
  { code: "cs", name: "Czech" },
  { code: "cy", name: "Welsh" },
  { code: "da", name: "Danish" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "et", name: "Estonian" },
  { code: "eu", name: "Basque" },
  { code: "fa", name: "Persian" },
  { code: "fi", name: "Finnish" },
  { code: "fo", name: "Faroese" },
  { code: "fr", name: "French" },
  { code: "gl", name: "Galician" },
  { code: "gu", name: "Gujarati" },
  { code: "ha", name: "Hausa" },
  { code: "haw", name: "Hawaiian" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hr", name: "Croatian" },
  { code: "ht", name: "Haitian Creole" },
  { code: "hu", name: "Hungarian" },
  { code: "hy", name: "Armenian" },
  { code: "id", name: "Indonesian" },
  { code: "is", name: "Icelandic" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "jw", name: "Javanese" },
  { code: "ka", name: "Georgian" },
  { code: "kk", name: "Kazakh" },
  { code: "km", name: "Khmer" },
  { code: "kn", name: "Kannada" },
  { code: "ko", name: "Korean" },
  { code: "la", name: "Latin" },
  { code: "lb", name: "Luxembourgish" },
  { code: "ln", name: "Lingala" },
  { code: "lo", name: "Lao" },
  { code: "lt", name: "Lithuanian" },
  { code: "lv", name: "Latvian" },
  { code: "mg", name: "Malagasy" },
  { code: "mi", name: "Māori" },
  { code: "mk", name: "Macedonian" },
  { code: "ml", name: "Malayalam" },
  { code: "mn", name: "Mongolian" },
  { code: "mr", name: "Marathi" },
  { code: "ms", name: "Malay" },
  { code: "mt", name: "Maltese" },
  { code: "my", name: "Burmese" },
  { code: "ne", name: "Nepali" },
  { code: "nl", name: "Dutch" },
  { code: "nn", name: "Nynorsk" },
  { code: "no", name: "Norwegian" },
  { code: "oc", name: "Occitan" },
  { code: "pa", name: "Punjabi" },
  { code: "pl", name: "Polish" },
  { code: "ps", name: "Pashto" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "sa", name: "Sanskrit" },
  { code: "sd", name: "Sindhi" },
  { code: "si", name: "Sinhala" },
  { code: "sk", name: "Slovak" },
  { code: "sl", name: "Slovenian" },
  { code: "sn", name: "Shona" },
  { code: "so", name: "Somali" },
  { code: "sq", name: "Albanian" },
  { code: "sr", name: "Serbian" },
  { code: "su", name: "Sundanese" },
  { code: "sv", name: "Swedish" },
  { code: "sw", name: "Swahili" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "tg", name: "Tajik" },
  { code: "th", name: "Thai" },
  { code: "tk", name: "Turkmen" },
  { code: "tl", name: "Tagalog" },
  { code: "tr", name: "Turkish" },
  { code: "tt", name: "Tatar" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "uz", name: "Uzbek" },
  { code: "vi", name: "Vietnamese" },
  { code: "yi", name: "Yiddish" },
  { code: "yo", name: "Yoruba" },
  { code: "zh", name: "Chinese" },
];

export const WHISPER_LANGUAGE_MAX = WHISPER_LANGUAGES.length;

export function whisperLanguageByCode(code: string): WhisperLanguage | undefined {
  const tag = code.split("-")[0]?.toLowerCase();
  return WHISPER_LANGUAGES.find((l) => l.code === tag);
}

export function filterWhisperLanguages(query: string): WhisperLanguage[] {
  const q = query.trim().toLowerCase();
  if (!q) return WHISPER_LANGUAGES;
  return WHISPER_LANGUAGES.filter(
    (l) => l.name.toLowerCase().includes(q) || l.code.includes(q),
  );
}

/**
 * Whisper accepts one ISO 639-1 tag, or none (auto-detect). Several
 * project languages → omit the tag so it can identify each utterance.
 */
export function whisperLanguageTag(languageCodes: string[]): string | undefined {
  const unique = [
    ...new Set(
      languageCodes
        .map((code) => code.split("-")[0]?.toLowerCase())
        .filter((tag): tag is string => Boolean(tag && tag.length >= 2)),
    ),
  ];
  if (unique.length === 1) return unique[0];
  return undefined;
}
