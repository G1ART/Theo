/**
 * Korean name romanization for search.
 *
 * Revised Romanization of each syllable, plus the spellings people
 * actually type (김 kim/gim, 이 lee/yi/rhee, 박 park/bak, 최 choi,
 * 정 jung/jeong, 현 hyun/hyeon). No network calls.
 *
 * A Latin query is turned back into Hangul only when the whole token
 * round-trips, so "park" stays a surname alias and does not become a
 * guessed given name.
 */

const HANGUL_BASE = 0xac00;
const HANGUL_SYLLABLE = /[가-힣]/;

const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"] as const;
const JUNG = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
] as const;
const JONG = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t",
] as const;

/** Two-syllable family names, checked before the one-syllable default. */
const DOUBLE_SURNAMES = ["남궁", "선우", "독고", "제갈", "황보", "사공", "서문"] as const;

/**
 * Common family-name spellings. The first alias is the one foreigners
 * usually type. Single-letter aliases are omitted on purpose.
 */
const SURNAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  김: ["kim", "gim"],
  이: ["lee", "yi", "rhee", "ee", "yee"],
  박: ["park", "bak", "pak"],
  최: ["choi", "choe", "chwe"],
  정: ["jung", "jeong", "chung", "chong", "joung"],
  강: ["kang", "gang"],
  조: ["cho", "jo"],
  윤: ["yoon", "yun", "youn"],
  장: ["jang", "chang"],
  임: ["lim", "im", "rim", "yim"],
  한: ["han"],
  오: ["oh"],
  서: ["seo", "suh"],
  신: ["shin", "sin"],
  권: ["kwon", "gwon", "kweon"],
  황: ["hwang", "whang"],
  안: ["ahn", "an"],
  송: ["song"],
  홍: ["hong"],
  유: ["yoo", "yu", "you"],
  고: ["ko", "go", "koh"],
  문: ["moon", "mun"],
  양: ["yang"],
  손: ["son", "sohn"],
  배: ["bae", "pae"],
  백: ["baek", "paek", "back"],
  허: ["heo", "huh", "hur"],
  노: ["noh", "roh"],
  남: ["nam", "nahm"],
  심: ["shim", "sim"],
  하: ["ha"],
  곽: ["kwak", "gwak"],
  성: ["sung", "seong"],
  차: ["cha"],
  주: ["joo", "ju", "chu"],
  우: ["woo", "wu"],
  구: ["koo", "gu", "ku"],
  민: ["min"],
  진: ["jin", "chin"],
  지: ["ji", "jee"],
  엄: ["eom", "um", "ohm"],
  원: ["won", "weon"],
  천: ["cheon", "chun"],
  방: ["bang", "pang"],
  공: ["kong", "gong"],
  현: ["hyun", "hyeon", "hyon"],
  함: ["ham", "hahm"],
  변: ["byun", "byeon", "pyun"],
  염: ["yeom", "yum"],
  여: ["yeo", "yuh"],
  추: ["chu", "choo"],
  도: ["do", "doh"],
  소: ["soh"],
  석: ["seok", "suk"],
  선: ["sun", "seon"],
  설: ["seol", "sul"],
  마: ["ma"],
  길: ["gil", "kil"],
  연: ["yeon", "yon"],
  위: ["wi", "wee"],
  표: ["pyo"],
  명: ["myung", "myeong"],
  반: ["ban", "pan"],
  왕: ["wang"],
  금: ["geum", "kum", "keum"],
  옥: ["ok", "oak"],
  육: ["yuk", "yook"],
  인: ["inn"],
  맹: ["maeng"],
  편: ["pyun", "pyeon"],
  봉: ["bong"],
  남궁: ["namgung", "namgoong", "namkoong"],
  선우: ["sunwoo", "seonwoo"],
  독고: ["dokgo"],
  제갈: ["jegal"],
  황보: ["hwangbo"],
  사공: ["sagong"],
  서문: ["seomun"],
};

const ALIAS_TO_SURNAME: Record<string, string> = {};
for (const [hangul, aliases] of Object.entries(SURNAME_ALIASES)) {
  for (const alias of aliases) {
    if (alias.length < 2) continue;
    if (!ALIAS_TO_SURNAME[alias]) ALIAS_TO_SURNAME[alias] = hangul;
  }
}

const ONSETS: { latin: string; chos: number[] }[] = [
  { latin: "kk", chos: [1] },
  { latin: "tt", chos: [4] },
  { latin: "pp", chos: [8] },
  { latin: "jj", chos: [13] },
  { latin: "ch", chos: [14] },
  { latin: "ss", chos: [10] },
  { latin: "k", chos: [0, 15] },
  { latin: "g", chos: [0] },
  { latin: "t", chos: [3, 16] },
  { latin: "d", chos: [3] },
  { latin: "n", chos: [2] },
  { latin: "r", chos: [5] },
  { latin: "l", chos: [5] },
  { latin: "m", chos: [6] },
  { latin: "b", chos: [7] },
  { latin: "p", chos: [7, 17] },
  { latin: "s", chos: [9] },
  { latin: "j", chos: [12] },
  { latin: "h", chos: [18] },
];

const VOWELS: { latin: string; jung: number }[] = [
  { latin: "yae", jung: 3 },
  { latin: "yeo", jung: 6 },
  { latin: "wae", jung: 10 },
  { latin: "ae", jung: 1 },
  { latin: "eo", jung: 4 },
  { latin: "eu", jung: 18 },
  { latin: "oe", jung: 11 },
  { latin: "ui", jung: 19 },
  { latin: "ya", jung: 2 },
  { latin: "ye", jung: 7 },
  { latin: "yo", jung: 12 },
  { latin: "yu", jung: 17 },
  { latin: "wa", jung: 9 },
  { latin: "wo", jung: 14 },
  { latin: "we", jung: 15 },
  { latin: "wi", jung: 16 },
  { latin: "a", jung: 0 },
  { latin: "e", jung: 5 },
  { latin: "i", jung: 20 },
  { latin: "o", jung: 8 },
  { latin: "u", jung: 13 },
];

const CODAS: { latin: string; jong: number }[] = [
  { latin: "ng", jong: 21 },
  { latin: "n", jong: 4 },
  { latin: "k", jong: 1 },
  { latin: "l", jong: 8 },
  { latin: "m", jong: 16 },
  { latin: "p", jong: 17 },
  { latin: "t", jong: 7 },
  { latin: "", jong: 0 },
];

/** Which syllable onsets a one-letter initial may start. ㄱ also matches "k". */
const CHO_FOR_INITIAL: Record<string, number[]> = {
  g: [0],
  k: [0, 15],
  n: [2],
  d: [3],
  t: [3, 16],
  r: [5],
  l: [5],
  m: [6],
  b: [7],
  p: [7, 17],
  s: [9],
  j: [12],
  c: [14],
  h: [18],
};

const hangulCache = new Map<string, string | null>();

export function hasHangulText(value: string): boolean {
  return HANGUL_SYLLABLE.test(value);
}

function decompose(ch: string): { cho: number; jung: number; jong: number } | null {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > 0xd7a3) return null;
  const n = code - HANGUL_BASE;
  return {
    cho: Math.floor(n / 588),
    jung: Math.floor((n % 588) / 28),
    jong: n % 28,
  };
}

function compose(cho: number, jung: number, jong: number): string {
  return String.fromCharCode(HANGUL_BASE + (cho * 21 + jung) * 28 + jong);
}

function romanizeSyllable(ch: string): string {
  const parts = decompose(ch);
  if (!parts) return "";
  return CHO[parts.cho] + JUNG[parts.jung] + JONG[parts.jong];
}

/** Revised Romanization, syllables joined, spaces kept. */
export function romanizeRevised(text: string): string {
  let out = "";
  for (const ch of text.trim()) {
    if (/\s/.test(ch) || ch === "-" || ch === "·") {
      if (out && !out.endsWith(" ")) out += " ";
      continue;
    }
    const syllable = romanizeSyllable(ch);
    out += syllable || ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Collapse hyun/hyeon, jung/jeong, gim/kim, and the usual consonant pairs. */
export function looseFold(value: string): string {
  let s = value.toLowerCase().replace(/[^a-z]/g, "");
  const rules: Array<[string, string]> = [
    ["hyeon", "hyun"],
    ["hyeong", "hyung"],
    ["yeong", "yung"],
    ["young", "yung"],
    ["yeon", "yun"],
    ["yeo", "yu"],
    ["eo", "u"],
    ["eu", "u"],
    ["ae", "e"],
    ["oe", "oi"],
    ["oo", "u"],
    ["gy", "ky"],
  ];
  for (const [from, to] of rules) s = s.split(from).join(to);
  return s.replace(/g/g, "k").replace(/d/g, "t").replace(/b/g, "p").replace(/r/g, "l");
}

function lettersOnly(token: string): string {
  return token.toLowerCase().replace(/[^a-z]/g, "");
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diffs = 0;
    for (let i = 0; i < la; i += 1) {
      if (a[i] !== b[i]) {
        diffs += 1;
        if (diffs > 1) return false;
      }
    }
    return diffs === 1;
  }
  const shorter = la < lb ? a : b;
  const longer = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j += 1;
    }
  }
  return true;
}

export function surnameHangul(token: string): string | null {
  const key = lettersOnly(token);
  if (key.length < 2) return null;
  const exact = ALIAS_TO_SURNAME[key];
  if (exact) return exact;
  if (key.length < 4) return null;
  let found: string | null = null;
  for (const [alias, hangul] of Object.entries(ALIAS_TO_SURNAME)) {
    if (alias.length < 3) continue;
    if (!withinOneEdit(key, alias)) continue;
    if (found && found !== hangul) return null;
    found = hangul;
  }
  return found;
}

export function surnameAliases(hangul: string): string[] {
  return [...(SURNAME_ALIASES[hangul] ?? [])];
}

function normalizeSpellings(value: string): string {
  let s = value.toLowerCase().replace(/[^a-z]/g, "");
  const rules: Array<[string, string]> = [
    ["hyung", "hyeong"],
    ["hyun", "hyeon"],
    ["kyung", "gyeong"],
    ["kyong", "gyeong"],
    ["young", "yeong"],
    ["jung", "jeong"],
    ["sung", "seong"],
    ["oo", "u"],
  ];
  for (const [from, to] of rules) s = s.split(from).join(to);
  return s;
}

function commonGivenSpellings(rr: string): string[] {
  const swapped = rr
    .replaceAll("hyeon", "hyun")
    .replaceAll("hyeong", "hyung")
    .replaceAll("yeong", "young")
    .replaceAll("yeon", "yun")
    .replaceAll("yeo", "yu")
    .replaceAll("eo", "u")
    .replaceAll("eu", "u")
    .replaceAll("ae", "e")
    .replaceAll("oe", "oi");
  return swapped === rr ? [rr] : [rr, swapped];
}

/**
 * Latin token → Hangul when every letter is consumed and romanizing
 * the result folds back to the same key. Otherwise null.
 */
export function latinToHangul(token: string): string | null {
  const key = normalizeSpellings(token);
  if (key.length < 2 || key.length > 18) return null;
  const cached = hangulCache.get(key);
  if (cached !== undefined) return cached;
  const parsed = parseLatin(key);
  hangulCache.set(key, parsed);
  return parsed;
}

function parseLatin(key: string): string | null {
  const want = looseFold(key);
  const found: string[] = [];
  let calls = 0;

  const visit = (pos: number, acc: string[]) => {
    if (found.length >= 4 || calls > 2500) return;
    calls += 1;
    if (pos === key.length) {
      if (acc.length > 0) found.push(acc.join(""));
      return;
    }
    if (acc.length >= 6) return;

    let matchedOnset = false;
    for (const onset of ONSETS) {
      if (!key.startsWith(onset.latin, pos)) continue;
      matchedOnset = true;
      const vpos = pos + onset.latin.length;
      for (const cho of onset.chos) {
        extendSyllable(vpos, cho, acc, visit);
        if (found.length >= 4) return;
      }
    }
    const head = key[pos] ?? "";
    if (!matchedOnset && "aeiouyw".includes(head)) {
      extendSyllable(pos, 11, acc, visit);
    }
  };

  const extendSyllable = (
    vpos: number,
    cho: number,
    acc: string[],
    visit: (pos: number, acc: string[]) => void,
  ) => {
    for (const vowel of VOWELS) {
      if (!key.startsWith(vowel.latin, vpos)) continue;
      const cpos = vpos + vowel.latin.length;
      for (const coda of CODAS) {
        if (coda.latin && !key.startsWith(coda.latin, cpos)) continue;
        visit(cpos + coda.latin.length, [...acc, compose(cho, vowel.jung, coda.jong)]);
        if (found.length >= 4) return;
      }
    }
  };

  visit(0, []);
  for (const hangul of found) {
    if (looseFold(romanizeRevised(hangul)) === want) return hangul;
  }
  return null;
}

export function splitHangulName(value: string): { surname: string; given: string } | null {
  const compact = [...value].filter((ch) => HANGUL_SYLLABLE.test(ch)).join("");
  const chars = [...compact];
  if (chars.length < 2 || chars.length > 5) return null;
  const two = chars.slice(0, 2).join("");
  if ((DOUBLE_SURNAMES as readonly string[]).includes(two) && chars.length >= 3) {
    return { surname: two, given: chars.slice(2).join("") };
  }
  return { surname: chars[0] ?? "", given: chars.slice(1).join("") };
}

function hangulNameCandidates(value: string): string[] {
  if (value.length > 80) return [];
  const chars = [...value].filter((ch) => HANGUL_SYLLABLE.test(ch));
  if (chars.length < 2) return [];
  if (chars.length <= 5) return [chars.join("")];
  if (chars.length > 12) return [];
  const out: string[] = [];
  for (const size of [3, 4]) {
    for (let i = 0; i + size <= chars.length && out.length < 8; i += 1) {
      out.push(chars.slice(i, i + size).join(""));
    }
  }
  return out;
}

/** Spaced and reversed romanizations of a Hangul personal name or phrase. */
export function romanizedSearchForms(value: string): string[] {
  const compact = [...value].filter((ch) => HANGUL_SYLLABLE.test(ch)).join("");
  if (!compact) return [];
  const name = splitHangulName(compact);
  const out: string[] = [];
  if (name) {
    const rrGiven = [...name.given].map((ch) => romanizeSyllable(ch)).join("");
    const givenForms = commonGivenSpellings(rrGiven);
    const surnames = surnameAliases(name.surname);
    const surnameForms = surnames.length > 0 ? surnames.slice(0, 3) : [romanizeRevised(name.surname)];
    for (const surname of surnameForms) {
      for (const given of givenForms) {
        out.push(`${surname} ${given}`);
        out.push(`${given} ${surname}`);
        out.push(`${surname}${given}`);
      }
    }
    if ([...name.given].length === 2) {
      const parts = [...name.given].map((ch) => romanizeSyllable(ch));
      const commonParts = parts.map((part) => commonGivenSpellings(part)[1] ?? part);
      out.push(`${surnameForms[0]} ${parts.join("-")}`);
      out.push(`${surnameForms[0]} ${commonParts.join("-")}`);
    }
  }
  const rr = romanizeRevised(compact);
  if (rr) out.push(rr);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const form of out) {
    const key = form.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
    if (unique.length >= 8) break;
  }
  return unique;
}

function queryTokens(raw: string): string[] {
  return raw
    .trim()
    .replace(/[%_\\,()"*]/g, " ")
    .split(/\s+/)
    .map((part) => part.replace(/^@+/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function surnameIndex(tokens: string[]): number {
  if (tokens.length === 0) return -1;
  const hits = tokens.map((token) => surnameHangul(token));
  if (hits[hits.length - 1]) return hits.length - 1;
  return hits.findIndex(Boolean);
}

function givenStartsWithInitial(givenHangul: string, initial: string): boolean {
  const first = [...givenHangul][0];
  if (!first) return false;
  const parts = decompose(first);
  if (!parts) return false;
  const letter = initial.toLowerCase();
  if (parts.cho === 11) return JUNG[parts.jung].startsWith(letter);
  const choLetters = CHO_FOR_INITIAL[letter];
  if (choLetters?.includes(parts.cho)) return true;
  const rr = CHO[parts.cho];
  return rr.startsWith(letter);
}

function givenClose(queryGiven: string, givenHangul: string): boolean {
  const q = lettersOnly(queryGiven);
  if (!q) return true;
  if (!givenHangul) return false;
  if (q.length === 1) return givenStartsWithInitial(givenHangul, q);
  const foldedGiven = looseFold([...givenHangul].map((ch) => romanizeSyllable(ch)).join(""));
  const foldedQuery = looseFold(q);
  if (!foldedGiven || !foldedQuery) return false;
  if (foldedGiven === foldedQuery) return true;
  if (q.length >= 2 && foldedGiven.startsWith(foldedQuery)) return true;
  if (foldedQuery.length >= 4 && withinOneEdit(foldedQuery, foldedGiven)) return true;
  return false;
}

function latinGivenClose(queryGiven: string, nameGiven: string): boolean {
  const q = lettersOnly(queryGiven);
  const name = lettersOnly(nameGiven);
  if (!q) return true;
  if (!name) return false;
  if (q.length === 1) return name.startsWith(q);
  const a = looseFold(q);
  const b = looseFold(name);
  if (a === b) return true;
  if (q.length >= 2 && b.startsWith(a)) return true;
  if (a.length >= 4 && withinOneEdit(a, b)) return true;
  return false;
}

/**
 * "Hyunmin Kim" / "hyeonmin kim" / "h kim" against a Hangul name.
 * A different family name does not match. A one-letter given name is
 * only the start of the given name (ㅎ for "h"), not a later syllable.
 */
export function latinQueryMatchesHangulName(query: string, hangulName: string): boolean {
  if (hasHangulText(query)) return false;
  const split = splitHangulName(hangulName);
  if (!split) return false;
  const tokens = queryTokens(query);
  if (tokens.length === 0 || tokens.some((token) => hasHangulText(token))) return false;
  const idx = surnameIndex(tokens);
  if (idx >= 0) {
    const hangul = surnameHangul(tokens[idx] ?? "");
    if (!hangul || hangul !== split.surname) return false;
    const given = tokens.filter((_, i) => i !== idx).join("");
    return givenClose(given, split.given);
  }
  const joined = tokens.map((token) => lettersOnly(token)).join("");
  if (!joined) return false;
  if (givenClose(joined, split.given)) return true;
  const full = looseFold([...split.surname, ...split.given].map((ch) => romanizeSyllable(ch)).join(""));
  return looseFold(joined) === full;
}

function latinQueryMatchesLatinName(query: string, latinName: string): boolean {
  if (hasHangulText(query) || hasHangulText(latinName)) return false;
  const qTokens = queryTokens(query);
  const nTokens = queryTokens(latinName);
  const qIdx = surnameIndex(qTokens);
  const nIdx = surnameIndex(nTokens);
  if (qIdx < 0 || nIdx < 0) return false;
  const qSurname = surnameHangul(qTokens[qIdx] ?? "");
  const nSurname = surnameHangul(nTokens[nIdx] ?? "");
  if (!qSurname || qSurname !== nSurname) return false;
  const qGiven = qTokens.filter((_, i) => i !== qIdx).join("");
  const nGiven = nTokens.filter((_, i) => i !== nIdx).join("");
  return latinGivenClose(qGiven, nGiven);
}

function hangulQueryMatchesLatinField(query: string, field: string): boolean {
  if (!hasHangulText(query) || hasHangulText(field)) return false;
  const hay = field.toLowerCase();
  return romanizedSearchForms(query).some((form) => hay.includes(form.toLowerCase()));
}

/** True when any short name-like field is the same person in the other script. */
export function nameFieldsMatchQuery(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const q = query.trim();
  if (!q) return false;
  for (const field of fields) {
    if (typeof field !== "string") continue;
    const text = field.trim();
    if (!text || text.length > 80) continue;
    for (const candidate of hangulNameCandidates(text)) {
      if (latinQueryMatchesHangulName(q, candidate)) return true;
    }
    if (latinQueryMatchesLatinName(q, text)) return true;
    if (hangulQueryMatchesLatinField(q, text)) return true;
  }
  return false;
}

/**
 * Full Hangul name for a Latin query, when the given name round-trips.
 * "h kim" has no single Hangul spelling, so it returns null.
 */
export function reconstructedHangulName(query: string): string | null {
  const tokens = queryTokens(query);
  if (tokens.length === 0 || tokens.some((token) => hasHangulText(token))) return null;
  const idx = surnameIndex(tokens);
  if (idx < 0) return latinToHangul(tokens.map((token) => lettersOnly(token)).join(""));
  const surname = surnameHangul(tokens[idx] ?? "");
  if (!surname) return null;
  const givenRaw = tokens.filter((_, i) => i !== idx).map((token) => lettersOnly(token)).join("");
  if (givenRaw.length < 2) return null;
  const given = latinToHangul(givenRaw);
  if (!given) return null;
  return surname + given;
}

export type LooseInitial = { surname: string; initial: string; aliases: string[] };

/** "h kim": family name plus a one-letter given name. */
export function looseInitialQuery(query: string): LooseInitial | null {
  const tokens = queryTokens(query);
  if (tokens.length < 2 || tokens.some((token) => hasHangulText(token))) return null;
  const idx = surnameIndex(tokens);
  if (idx < 0) return null;
  const surname = surnameHangul(tokens[idx] ?? "");
  if (!surname) return null;
  const given = tokens.filter((_, i) => i !== idx).map((token) => lettersOnly(token)).join("");
  if (given.length !== 1 || !/[a-z]/.test(given)) return null;
  const aliases = surnameAliases(surname);
  if (aliases.length === 0) return null;
  return { surname, initial: given, aliases };
}

/** Syllables foreigners' "h …" queries should still recall, ahead of the long tail. */
const PREFERRED_H = [
  "현", "하", "혜", "호", "희", "훈", "형", "홍", "화", "환", "혁", "헌", "한", "해", "후", "휴", "휘", "향", "함", "황", "회", "효", "흔", "흥", "허",
] as const;

/**
 * Short compound list for PostgREST `or` URLs. The in-memory check still
 * accepts every onset, so a recalled row is not limited to this list.
 */
export function initialRecallCompounds(surname: string, initial: string): string[] {
  const all = initialCompounds(surname, initial);
  if (initial.toLowerCase() === "h") {
    const preferred = PREFERRED_H.map((syllable) => surname + syllable);
    return [...new Set([...preferred, ...all])].slice(0, 24);
  }
  return all.slice(0, 24);
}

/** Hangul family name plus a given-name syllable that starts with the initial. */
export function initialCompounds(surname: string, initial: string): string[] {
  const letter = initial.toLowerCase();
  const chos = CHO_FOR_INITIAL[letter];
  const out: string[] = [];
  if (chos) {
    for (const cho of chos) {
      for (let jung = 0; jung < JUNG.length; jung += 1) {
        for (const jong of [0, 4, 21]) out.push(surname + compose(cho, jung, jong));
      }
    }
    return out;
  }
  if (!"aeiouy".includes(letter)) return out;
  for (let jung = 0; jung < JUNG.length; jung += 1) {
    if (!JUNG[jung].startsWith(letter)) continue;
    for (const jong of [0, 4, 21]) out.push(surname + compose(11, jung, jong));
  }
  return out;
}

/** Extra OR terms for one query token (Hangul for Latin, romanization for Hangul). */
export function crossScriptAlts(token: string, tokens: readonly string[]): string[] {
  const out: string[] = [];
  if (hasHangulText(token)) {
    out.push(...romanizedSearchForms(token));
    return out;
  }
  const surname = surnameHangul(token);
  if (surname) out.push(surname);
  else {
    const hangul = latinToHangul(token);
    if (hangul) out.push(hangul);
  }
  const full = reconstructedHangulName(tokens.join(" "));
  if (full) out.push(full);
  return out;
}

export function isCrossScriptQuery(query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => hasHangulText(token))) return true;
  if (looseInitialQuery(query)) return true;
  if (reconstructedHangulName(query)) return true;
  return tokens.some((token) => surnameHangul(token) != null || latinToHangul(token) != null);
}

function quotePattern(body: string): string | null {
  const cleaned = body.replace(/[,()"\\]/g, "").slice(0, 80);
  if (!cleaned || cleaned === "%" || cleaned === "%%") return null;
  return `"${cleaned}"`;
}

function columnKind(column: string): "hangul" | "latin" | "both" | "skip" {
  const name = column.toLowerCase();
  if (!(name.includes("name") || name.includes("title") || name.includes("username"))) return "skip";
  const hangul = !name.endsWith("_en");
  const latin = !name.endsWith("_ko");
  if (hangul && latin) return "both";
  if (hangul) return "hangul";
  if (latin) return "latin";
  return "skip";
}

/**
 * One PostgREST `or` clause for "h kim": Hangul compounds (김현, 김하, …)
 * plus Latin patterns (`h%kim`, `kim h%`). Null when the query is not
 * an initial plus a family name.
 */
export function looseInitialIlikeClause(
  query: string,
  columns: readonly string[],
): string | null {
  const loose = looseInitialQuery(query);
  if (!loose || columns.length === 0) return null;
  const compounds = initialRecallCompounds(loose.surname, loose.initial);
  const parts: string[] = [];
  for (const column of columns) {
    const kind = columnKind(column);
    if (kind === "skip") continue;
    if (kind === "hangul" || kind === "both") {
      for (const compound of compounds) {
        const pattern = quotePattern(`%${compound}%`);
        if (pattern) parts.push(`${column}.ilike.${pattern}`);
      }
    }
    if (kind === "latin" || kind === "both") {
      for (const alias of loose.aliases.slice(0, 3)) {
        for (const body of [
          `${loose.initial}%${alias}`,
          `${loose.initial}% ${alias}`,
          `${alias} ${loose.initial}%`,
        ]) {
          const pattern = quotePattern(body);
          if (pattern) parts.push(`${column}.ilike.${pattern}`);
        }
      }
    }
  }
  return parts.length > 0 ? parts.join(",") : null;
}
