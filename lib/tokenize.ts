/**
 * Tokenization for the transcript.
 *
 * A segment's text is always `words.map(w => w.text).join(" ")` (§6.5), so the
 * inverse operation — turning edited text back into tokens — must be a plain
 * Unicode-whitespace split. That keeps the round-trip exact and, as a side
 * effect, keeps apostrophes and hyphens inside tokens: `don't`, `Zürich-Nord`
 * and `d’accord` are one token each, never split.
 *
 * Nothing here alters a token's surface form. Normalization exists only to
 * compare tokens during the diff (§8.3.2) — the stored `Word.text` is always
 * the surface form the user typed.
 */

const WHITESPACE = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/u;

export interface RawToken {
  /** surface form, exactly as written */
  text: string;
  /** normalized form, used only for comparison */
  norm: string;
}

export function splitTokens(text: string): string[] {
  const trimmed = text.replace(/^\s+|\s+$/gu, "");
  if (trimmed.length === 0) return [];
  return trimmed.split(WHITESPACE);
}

/**
 * Casefold and strip *edge* punctuation so that `University,` and `university`
 * compare equal during the diff. Interior punctuation (apostrophes, hyphens)
 * is preserved because it distinguishes real word forms.
 */
export function normalizeToken(token: string): string {
  const nfc = token.normalize("NFC");
  const stripped = nfc.replace(/^[\p{P}\p{S}]+/u, "").replace(/[\p{P}\p{S}]+$/u, "");
  const core = stripped.length > 0 ? stripped : nfc;
  return core.toLowerCase();
}

export function tokenize(text: string): RawToken[] {
  return splitTokens(text).map((t) => ({ text: t, norm: normalizeToken(t) }));
}

/** Does this token end a sentence? Used by the segmenter (§6.5). */
const SENTENCE_FINAL = /[.?!…]["'”’»)\]]*$/u;

export function endsSentence(token: string): boolean {
  return SENTENCE_FINAL.test(token.normalize("NFC"));
}

export function joinTokens(tokens: string[]): string {
  return tokens.join(" ");
}
