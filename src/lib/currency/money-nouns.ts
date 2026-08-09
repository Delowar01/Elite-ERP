/**
 * The nouns money is counted in, and how they inflect.
 *
 * Amount-in-words on an Arabic invoice is a counted phrase, and Arabic agreement has more cases
 * than "singular or plural": a dual for exactly two, a plural for 3–10, and an accusative singular
 * (tamyīz) for 11–99. The numeral itself also takes the *opposite* gender to the noun it counts —
 * ثلاث هللات but ثلاثة ريالات. That polarity is why the numerals come from `n2words`, which
 * implements it, rather than from anything written here.
 *
 * What this file owns is the noun side, which no library can supply because it depends on the
 * currency rather than the number. It is deliberately a table of **nouns, not currencies**: the six
 * GCC currencies share six nouns between them — ريال covers SAR, QAR and OMR; دينار covers KWD and
 * BHD; فلس is the subunit of AED, KWD and BHD. Twenty-four forms, not seventy-two.
 *
 * **Only reviewed currencies appear here** — the GCC six plus USD, EUR and JPY, ten in total, each
 * form checked by a native speaker. Everything else falls through to the digit form ("و75/100"),
 * which is plain but never wrong. Generating inflections nobody here can verify would put
 * unverifiable Arabic on a tax document, and a wrong word in a language the reader trusts is worse
 * than an obviously mechanical fallback. See docs/backlog.md for the currencies still awaiting
 * review.
 */

/** One noun, in the four forms a counted phrase can need, plus the gender the numeral agrees with. */
export type MoneyNoun = {
  /** Grammatical gender of the NOUN. `n2words` applies numeral polarity from this. */
  gender: "masculine" | "feminine";
  /** Count 1, and 100+ (مائة ريال). */
  singular: string;
  /** Count exactly 2. */
  dual: string;
  /** Counts 3–10. */
  plural: string;
  /** Counts 11–99 — the accusative singular, tamyīz. The formal invoice register. */
  accusative: string;
  /** English singular and plural. Explicit, because "fils" and "baisa" do not take an -s. */
  en: { one: string; many: string };
};

const RIYAL: MoneyNoun = {
  gender: "masculine",
  singular: "ريال", dual: "ريالان", plural: "ريالات", accusative: "ريالاً",
  en: { one: "Riyal", many: "Riyals" },
};
const DINAR: MoneyNoun = {
  gender: "masculine",
  singular: "دينار", dual: "ديناران", plural: "دنانير", accusative: "ديناراً",
  en: { one: "Dinar", many: "Dinars" },
};
const DIRHAM: MoneyNoun = {
  gender: "masculine",
  singular: "درهم", dual: "درهمان", plural: "دراهم", accusative: "درهماً",
  en: { one: "Dirham", many: "Dirhams" },
};
const HALALA: MoneyNoun = {
  gender: "feminine",
  singular: "هللة", dual: "هللتان", plural: "هللات", accusative: "هللةً",
  en: { one: "Halala", many: "Halalas" },
};
const FILS: MoneyNoun = {
  gender: "masculine",
  singular: "فلس", dual: "فلسان", plural: "فلوس", accusative: "فلساً",
  en: { one: "Fils", many: "Fils" }, // invariant in English
};
const BAISA: MoneyNoun = {
  gender: "feminine",
  singular: "بيسة", dual: "بيستان", plural: "بيسات", accusative: "بيسةً",
  en: { one: "Baisa", many: "Baisa" }, // invariant in English
};

// --- Beyond the GCC: majors with verified Arabic names -----------------------------------------
// Added because an English currency name inside an Arabic sentence ("ألف ومئتان وخمسون Japanese
// Yen") was the last Latin script left on an Arabic invoice. These follow exactly the same
// accusative pattern as the GCC nouns, so they extend this table rather than needing a mechanism
// of their own.
//
// ين ياباني is a noun plus an adjective that inflects with it. No structural change was needed:
// each form is a plain string, so both words simply live in the same field.
const DOLLAR: MoneyNoun = {
  gender: "masculine",
  singular: "دولار", dual: "دولاران", plural: "دولارات", accusative: "دولارًا",
  en: { one: "Dollar", many: "Dollars" },
};
const CENT_AR: MoneyNoun = {
  gender: "masculine",
  singular: "سنت", dual: "سنتان", plural: "سنتات", accusative: "سنتًا",
  en: { one: "Cent", many: "Cents" },
};
const YEN: MoneyNoun = {
  gender: "masculine",
  singular: "ين ياباني", dual: "ينان يابانيان", plural: "ينات يابانية", accusative: "ينًا يابانيًا",
  en: { one: "Yen", many: "Yen" }, // invariant in English
};
const EURO: MoneyNoun = {
  gender: "masculine",
  singular: "يورو", dual: "يوروان", plural: "يوروات", accusative: "يورو",
  en: { one: "Euro", many: "Euros" },
};
// GBP is deliberately absent. Its forms are the same noun+adjective shape as ين ياباني and were
// drafted, but the review did not take them up, so they stay unverified and GBP keeps the digit
// fallback. Adding it later is data, not structure. See docs/backlog.md.

/**
 * Currencies with verified Arabic nouns. `major` is the unit, `sub` its minor unit — note QAR's subunit is the dirham,
 * the same noun that is the UAE's *major* unit.
 */
export const MONEY_NOUNS: Record<string, { major: MoneyNoun; sub: MoneyNoun | null }> = {
  SAR: { major: RIYAL, sub: HALALA },
  QAR: { major: RIYAL, sub: DIRHAM },
  OMR: { major: RIYAL, sub: BAISA },
  KWD: { major: DINAR, sub: FILS },
  BHD: { major: DINAR, sub: FILS },
  AED: { major: DIRHAM, sub: FILS },
  // Majors outside the GCC. JPY has no minor unit in practice — sub is null, not a zero-count noun.
  USD: { major: DOLLAR, sub: CENT_AR },
  EUR: { major: EURO, sub: CENT_AR },
  JPY: { major: YEN, sub: null },
};

/**
 * The form a noun takes for a given count.
 *
 * 1 → singular · 2 → dual · 3–10 → plural · 11–99 → accusative singular · 100+ → singular.
 *
 * The last is not an oversight: Arabic returns to the singular after 99 (مائة ريال, ألف ريال).
 * Written once, here, so the boundaries are testable in one place rather than re-derived at each
 * call site.
 */
export function nounForm(noun: MoneyNoun, count: number): string {
  const n = Math.abs(Math.trunc(count));
  // The form follows the LAST TWO DIGITS, not the magnitude. 1,250 ends in 50, so it takes the
  // accusative — ألف ومئتان وخمسون ريالاً — while 100 and 1,000 end in 00 and take the singular.
  // Keying on the whole number instead produced "خمسون ريال" for 1,250.50, which rendering caught.
  const r = n % 100;
  if (r === 0) return noun.singular;          // مائة ريال، ألف ريال
  if (r === 1) return noun.singular;
  if (r === 2) return n === 2 ? noun.dual : noun.singular; // a true dual only when the count IS two
  if (r >= 3 && r <= 10) return noun.plural;
  return noun.accusative;                      // 11–99, and any number ending in them
}

/**
 * The complete Arabic counted phrase — numeral and noun together.
 *
 * One and two do not take a numeral in front: the dual noun already carries "two" (ريالان, not
 * اثنان ريالان), and one is conventionally written noun-first (ريال واحد). Everything else is
 * numeral then noun. `spellNumber` is injected so this file stays free of any dependency on how
 * numerals are produced.
 */
export function countedPhraseAr(
  noun: MoneyNoun,
  count: number,
  spellNumber: (n: number, gender: "masculine" | "feminine") => string,
): string {
  const n = Math.abs(Math.trunc(count));
  if (n === 1) return `${noun.singular} ${noun.gender === "feminine" ? "واحدة" : "واحد"}`;
  if (n === 2) return noun.dual;
  return `${spellNumber(n, noun.gender)} ${nounForm(noun, n)}`;
}

/** English: plural for everything except exactly one. Invariant nouns carry the same word in both. */
export function nounFormEn(noun: MoneyNoun, count: number): string {
  return Math.abs(Math.trunc(count)) === 1 ? noun.en.one : noun.en.many;
}
