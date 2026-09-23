// Objectionable language filter for public profile text and Connect form messages
// (App Store Guideline 1.2, Google Play UGC policy). Report and block cover what a wordlist can't.
//
// Pure string code shared by the Worker and the app (Hermes and react-native-web), so no \p{}
// escapes or lookbehind. Linear in the input: zod runs refinements even on input that is too long.

/**
 * Slurs and severe profanity. Matched as whole words only, so Scunthorpe, Dickens and Niger pass.
 * Words that are also common names or have everyday meanings (dick, cock, coon, dyke, kike, spic,
 * chink, fag, phuc) are left out on purpose.
 */
const WORDS = [
  // Profanity
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'fuckin', 'fuckface', 'fuckhead', 'fuckwit',
  'fuckoff', 'fuckyou', 'motherfucker', 'motherfuckers', 'motherfucking', 'clusterfuck',
  'shit', 'shits', 'shitty', 'shitting', 'shithead', 'shithole', 'bullshit', 'horseshit', 'dipshit',
  'cunt', 'cunts', 'asshole', 'assholes', 'arsehole', 'arseholes', 'bitch', 'bitches',
  'whore', 'whores', 'slut', 'sluts', 'slutty', 'twat', 'twats', 'wanker', 'wankers',
  'cocksucker', 'cocksuckers', 'dickhead', 'dickheads', 'blowjob',
  // Slurs
  'nigger', 'niggers', 'nigga', 'niggas', 'sandnigger', 'faggot', 'faggots', 'tranny', 'trannies', 'shemale',
  'retard', 'retards', 'retarded', 'wetback', 'wetbacks', 'raghead', 'ragheads', 'towelhead', 'towelheads',
];

/** Leetspeak: the characters each letter may be written as. */
const LOOKALIKES: Partial<Record<string, string>> = {
  a: 'a4@',
  e: 'e3',
  i: 'i1!|',
  l: 'l1|',
  o: 'o0',
  s: 's5$',
  t: 't7',
  u: 'uv',
};

/** Cyrillic and Greek letters that look like Latin ones once lowercased, e.g. Cyrillic \u0441 for c. */
const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043a': 'k', '\u043c': 'm', '\u043d': 'h', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c',
  '\u0442': 't', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u04bb': 'h', '\u0501': 'd', '\u051d': 'w',
  // Greek
  '\u03b1': 'a', '\u03b9': 'i', '\u03ba': 'k', '\u03bd': 'v', '\u03bf': 'o', '\u03c4': 't', '\u03c5': 'u',
};
const HOMOGLYPH = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'g');

/** Combining marks left by NFKD (accents, zalgo) and variation selectors. */
const MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe00-\ufe0f\ufe20-\ufe2f]/g;
/** Zero-width, soft hyphen and bidi characters that split a word without showing. */
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** Characters that make up a word: letters, digits and the leetspeak symbols above. */
const NON_WORD = /[^a-z0-9@$!|]+/;
const SYMBOLS = /[@$!|]+/;

const letter = (c: string) => {
  const chars = LOOKALIKES[c];
  return chars ? `[${chars}]+` : `${c}+`;
};
/** Each letter may repeat (fuuuck), so `shit` becomes ^[s5$]+h+[i1!|]+[t7]+$. */
const LISTED = new RegExp(`^(?:${WORDS.map((w) => [...w].map(letter).join('')).join('|')})$`);

const SHORTEST = Math.min(...WORDS.map((w) => w.length));
const LONGEST = Math.max(...WORDS.map((w) => w.length));
/** Longer input can't pass the schemas' max lengths anyway, so only this much is checked. */
const MAX_INPUT = 5000;

/** Lowercases and removes accents, invisible characters and lookalike letters. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(HOMOGLYPH, (c) => HOMOGLYPHS[c] ?? c);
}

function isListed(word: string): boolean {
  // Runs of 3+ become 2, which keeps the regex cheap and still keeps the double letters it needs.
  const w = word.replace(/(.)\1{2,}/g, '$1$1');
  return w.length >= SHORTEST && w.length <= LONGEST * 2 && LISTED.test(w);
}

/** A listed word spelled out one character at a time: "f u c k", "s.h.i.t". */
function isSpelledOut(chars: string): boolean {
  for (let i = 0; i + SHORTEST <= chars.length; i++) {
    for (let n = SHORTEST; n <= LONGEST && i + n <= chars.length; n++) {
      if (LISTED.test(chars.slice(i, i + n))) return true;
    }
  }
  return false;
}

/**
 * True when `text` contains a slur or severe profanity, including accented, leetspeak (sh1t, a$$hole),
 * stretched (fuuuck), lookalike-letter and spaced out (f u c k) spellings. Checks the first
 * 5000 characters.
 */
export function hasObjectionableText(text: string): boolean {
  const words = fold(text.slice(0, MAX_INPUT)).split(NON_WORD);
  let singles = '';
  for (const word of words) {
    if (word.length === 1) {
      singles += word;
      continue;
    }
    if (isSpelledOut(singles)) return true;
    singles = '';
    // "shit!" and "hi!fuck" are one word here, so also try the parts between symbols.
    if (isListed(word) || word.split(SYMBOLS).some(isListed)) return true;
  }
  return isSpelledOut(singles);
}
