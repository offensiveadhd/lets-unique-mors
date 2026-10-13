/**
 * morse.js — International Morse for the mors unique: the table, encode and
 * decode, the timing rules, and the keyer state machine that turns presses
 * and silences into elements, letters and words. No DOM in here. CONTRACT.md
 * §1 (model, table, units) and §4 (keying, erasing) are the spec.
 */

/** Characters → patterns (International Morse). */
export const TABLE = Object.freeze({
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.',
  $: '...-..-', '@': '.--.-.',
});

/** Prosigns: keyed as one group without a gap. HH (8 dots) is the error sign and is never kept. */
export const PROSIGNS = Object.freeze({ AR: '.-.-.', SK: '...-.-', SOS: '...---...', BT: '-...-', KN: '-.--.', AS: '.-...', HH: '........' });

/** Patterns → characters. Prosigns AR, SK and SOS win over +; = ( & keep their punctuation reading. */
const DECODE = (() => {
  const m = new Map();
  for (const [c, p] of Object.entries(TABLE)) m.set(p, c);
  m.set(PROSIGNS.AR, '<AR>');
  m.set(PROSIGNS.SK, '<SK>');
  m.set(PROSIGNS.SOS, '<SOS>');
  return m;
})();

/** Units of silence that close a letter / a word while keying (nominal 3 and 7; the thresholds sit between). */
export const LETTER_GAP = 2.2;
export const WORD_GAP = 5.5;
/** Fixed unit for typed elements (. - _ keys), in ms: a typist's cadence, not a hand on a key. */
export const TYPED_UNIT = 160;
export const UNIT_MIN = 40;
export const UNIT_MAX = 400;
export const UNIT_DEFAULT = 100;
export const MAX_ELEMENTS = 4000;
export const MAX_GROUP = 8;

export const clampUnit = (u) => Math.max(UNIT_MIN, Math.min(UNIT_MAX, Math.round(u)));
export const wpmToUnit = (wpm) => clampUnit(1200 / Math.max(3, Math.min(30, +wpm || 12)));
export const unitToWpm = (unit) => Math.max(3, Math.min(30, Math.round(1200 / clampUnit(unit))));

/** Is this group the error prosign (eight or more dots)? */
export const isError = (group) => /^\.{8,}$/.test(group);

/**
 * Decode one group.
 * @param {string} group dots and dashes
 * @returns {{char:string, known:boolean}} char is "#" when the group is not in the table
 */
export function decodeGroup(group) {
  const c = DECODE.get(group);
  return c ? { char: c, known: true } : { char: '#', known: false };
}

/**
 * Parse a morse string ("... --- ... / -.-. --.-") into tokens.
 * @returns {Array<{m:string, c:string, ok:boolean}|{gap:true}>}
 */
export function parse(morse) {
  const out = [];
  const words = String(morse ?? '').trim().split(/\s*\/\s*/);
  for (let w = 0; w < words.length; w++) {
    const groups = words[w].split(/\s+/).filter(Boolean);
    if (w > 0 && out.length && groups.length) out.push({ gap: true });
    for (const g of groups) {
      const clean = g.replace(/[^.\-]/g, '');
      if (!clean) continue;
      const d = decodeGroup(clean);
      out.push({ m: clean, c: d.char, ok: d.known });
    }
  }
  return out;
}

/** Tokens → the morse string. */
export function toMorse(tokens) {
  let s = '';
  let prev = null;
  for (const t of tokens) {
    if (t.gap) { if (prev && !prev.gap) s += ' /'; }
    else s += (s ? ' ' : '') + t.m;
    prev = t;
  }
  return s.replace(/ \/$/, '').trim();
}

/** Tokens → the decoded text (uppercase, one space between words, "#" for unknown groups). */
export function toText(tokens) {
  let s = '';
  for (const t of tokens) {
    if (t.gap) { if (s && !s.endsWith(' ')) s += ' '; }
    else s += t.c;
  }
  return s.trim();
}

/** Decode a morse string straight to text. */
export const decode = (morse) => toText(parse(morse));

/**
 * Encode text to morse. Letters, digits and punctuation from the table; "<AR>", "<SK>", "<SOS>", "<BT>", "<KN>"
 * tokens become prosigns; spaces become word gaps; anything else is dropped.
 */
export function encode(text) {
  const tokens = encodeTokens(text);
  return toMorse(tokens);
}

/** Text → tokens (the same rules as encode). */
export function encodeTokens(text) {
  const out = [];
  const s = String(text ?? '').toUpperCase();
  let i = 0;
  let needGap = false;
  const push = (m, c) => {
    if (needGap && out.length) out.push({ gap: true });
    needGap = false;
    out.push({ m, c, ok: true });
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '<') {
      const end = s.indexOf('>', i);
      const name = end > i ? s.slice(i + 1, end) : '';
      if (name && PROSIGNS[name] && name !== 'HH') { push(PROSIGNS[name], `<${name}>`); i = end + 1; continue; }
    }
    if (/\s/.test(ch)) { if (out.length) needGap = true; i++; continue; }
    const p = TABLE[ch];
    if (p) push(p, ch);
    i++;
  }
  return out;
}

/**
 * The play schedule for tokens: elements and silences in units.
 * @returns {Array<{kind:"dot"|"dash"|"gap"|"lgap"|"wgap", units:number, token?:number}>} token = index into tokens for dots/dashes
 */
export function schedule(tokens) {
  const out = [];
  let prevLetter = false;
  tokens.forEach((t, ti) => {
    if (t.gap) { if (out.length) out.push({ kind: 'wgap', units: 7 }); prevLetter = false; return; }
    if (prevLetter) out.push({ kind: 'lgap', units: 3 });
    const els = t.m.split('');
    els.forEach((e, i) => {
      if (i > 0) out.push({ kind: 'gap', units: 1 });
      out.push({ kind: e === '.' ? 'dot' : 'dash', units: e === '.' ? 1 : 3, token: ti });
    });
    prevLetter = true;
  });
  return out;
}

/** Total play time of tokens at a unit, in ms. */
export const duration = (tokens, unit) => schedule(tokens).reduce((a, s) => a + s.units * unit, 0);

/** Count elements in tokens. */
export const countElements = (tokens) => tokens.reduce((a, t) => a + (t.gap ? 0 : t.m.length), 0);

/** Pretty pattern for the chart and the grid ("·−·"). */
export const pretty = (pattern) => pattern.replace(/\./g, '·').replace(/-/g, '−');

/** The chart, in display order. */
export const CHART = Object.freeze([
  { title: 'Letters', rows: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => [c, TABLE[c]]) },
  { title: 'Digits', rows: '1234567890'.split('').map((c) => [c, TABLE[c]]) },
  { title: 'Signs', rows: ['.', ',', '?', "'", '!', '/', '(', ')', '&', ':', ';', '=', '+', '-', '_', '"', '$', '@'].map((c) => [c, TABLE[c]]) },
  { title: 'Prosigns', rows: [['AR', PROSIGNS.AR, 'end of message'], ['SK', PROSIGNS.SK, 'end of contact'], ['SOS', PROSIGNS.SOS, 'distress'], ['BT', PROSIGNS.BT, 'new paragraph'], ['KN', PROSIGNS.KN, 'go ahead, named station'], ['HH', PROSIGNS.HH, 'error: erases the word']] },
  { title: 'On the air', rows: [['CQ', 'calling anyone'], ['K', 'over'], ['R', 'received'], ['73', 'best regards'], ['?', 'say again']] },
]);

/**
 * The keyer: presses and silences → elements, letters, words.
 *
 *   press(t) / release(t)  a press on the key (t = performance.now())
 *   typed(el, t)         a typed "." or "-" (fixed typed unit for the gaps)
 *   wordGap()            force the word to close now (typed "/")
 *   flush()              close the open letter and the word at once (before Send)
 *   dropOpen()           forget the open letter (erase)
 *
 * Callbacks: onElement(el, open), onLetter(group), onWord(), onUnit(unit).
 */
export class Keyer {
  constructor({ unit = UNIT_DEFAULT, auto = true, onElement, onLetter, onWord, onUnit, now = () => performance.now() } = {}) {
    this.unit = clampUnit(unit);
    this.auto = !!auto;
    this.onElement = onElement || (() => {});
    this.onLetter = onLetter || (() => {});
    this.onWord = onWord || (() => {});
    this.onUnit = onUnit || (() => {});
    this.now = now;
    this.open = '';
    this.downAt = null;
    this.inWord = false;
    this.lastTyped = false;
    this._lt = 0;
    this._wt = 0;
  }

  get down() { return this.downAt != null; }

  setUnit(unit) { this.unit = clampUnit(unit); this.onUnit(this.unit); }
  setWpm(wpm) { this.setUnit(wpmToUnit(wpm)); }

  /** A press started. */
  press(t = this.now()) {
    if (this.downAt != null) return false;
    this.downAt = t;
    this._clearTimers();
    return true;
  }

  /** The press ended: classify and append. Returns the element or null. */
  release(t = this.now()) {
    if (this.downAt == null) return null;
    const d = Math.max(1, t - this.downAt);
    this.downAt = null;
    const el = d < 2 * this.unit ? '.' : '-';
    if (this.auto) {
      const est = el === '.' ? d : d / 3;
      const u = clampUnit(0.75 * this.unit + 0.25 * est);
      if (u !== this.unit) { this.unit = u; this.onUnit(u); }
    }
    this.lastTyped = false;
    this._append(el, this.unit, t);
    return el;
  }

  /** A typed element (no press). */
  typed(el, t = this.now()) {
    if (this.downAt != null) return false;
    this.lastTyped = true;
    this._append(el === '-' ? '-' : '.', TYPED_UNIT, t);
    return true;
  }

  /** Force a word gap now (typed "/"). */
  wordGap() {
    this._clearTimers();
    this._closeLetter();
    this._closeWord();
  }

  /** Close whatever is open, at once. */
  flush() {
    this._clearTimers();
    this.downAt = null;
    this._closeLetter();
    if (this.inWord) this._closeWord();
  }

  /** Forget the open letter without emitting it. */
  dropOpen() {
    this._clearTimers();
    this.open = '';
    if (this.inWord) this._armWord(this.lastTyped ? TYPED_UNIT : this.unit);
  }

  /** Remove the last element of the open letter (Backspace); the rest keeps closing on silence. Returns false when nothing was open. */
  trimOpen() {
    if (!this.open) return false;
    this.open = this.open.slice(0, -1);
    if (!this.open) { this.dropOpen(); return true; }
    const unit = this.lastTyped ? TYPED_UNIT : this.unit;
    this._clearTimers();
    this._lt = setTimeout(() => { this._lt = 0; this._closeLetter(); }, LETTER_GAP * unit);
    this._wt = setTimeout(() => { this._wt = 0; this._closeWord(); }, WORD_GAP * unit);
    return true;
  }

  /** Stop the timers; the open letter stays open until the next element or flush. */
  pause() { this._clearTimers(); }

  /** Elements landed outside the keyer (assisted keying): the word is open and closes after a word gap of silence. */
  touch() { this.inWord = true; this._clearTimers(); this._armWord(this.unit); }

  _append(el, unit, t) {
    if (this.open.length >= MAX_GROUP && !(isError(this.open) && el === '.')) this._closeLetter();
    this.open += el;
    this.inWord = true;
    this.onElement(el, this.open);
    this._clearTimers();
    this._lt = setTimeout(() => { this._lt = 0; this._closeLetter(); }, LETTER_GAP * unit);
    this._wt = setTimeout(() => { this._wt = 0; this._closeWord(); }, WORD_GAP * unit);
    void t;
  }

  _closeLetter() {
    if (!this.open) return;
    const g = this.open;
    this.open = '';
    this.onLetter(g);
  }

  _armWord(unit) {
    clearTimeout(this._wt);
    this._wt = setTimeout(() => { this._wt = 0; this._closeWord(); }, WORD_GAP * unit);
  }

  _closeWord() {
    this._closeLetter();
    if (!this.inWord) return;
    this.inWord = false;
    this.onWord();
  }

  _clearTimers() { clearTimeout(this._lt); clearTimeout(this._wt); this._lt = 0; this._wt = 0; }
}
