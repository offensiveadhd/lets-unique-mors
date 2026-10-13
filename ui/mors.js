/**
 * mors.js — the window you talk through in Morse (the `mors` unique for lets).
 *
 * One key, one tape. The human keys dots and dashes; the tape shows them;
 * Send to Claude hands the message over as a prompt (`mors.export`). Only
 * Doto helps craft it: his menu offers read-back, a spelled ghost from Claude
 * (`mors.suggest`), a check, the chart and the full controller. Claude can
 * talk Morse back on a second track (`mors.play`). Contract: CONTRACT.md.
 * Everything non-mors (companion, chat, components, toasts) is the shell's
 * job (/sdk/lets-shell.js); this file only plugs into it.
 *
 *   1. constants & helpers      6. the key, sound and lamp
 *   2. boot                     7. the player (Claude's track, assisted keying)
 *   3. state                    8. outgoing events (changed, ask, send)
 *   4. message ops              9. incoming commands
 *   5. ghost                   10. rendering, companion, keyboard, start-up
 */

import { Lets } from '/sdk/lets-client.js';
import {
  TABLE, PROSIGNS, CHART, Keyer, parse, toMorse, toText, encodeTokens, schedule, decodeGroup, isError, pretty,
  clampUnit, wpmToUnit, unitToWpm, countElements, MAX_ELEMENTS, UNIT_DEFAULT, TYPED_UNIT,
} from './morse.js';

// ───────────────────────────── 1. constants & helpers ─────────────────────────────

const VERSION = '0.1.0';
const CAPS = ['entity', 'chat', 'components'];
const PREFS_KEY = 'lets.mors';
const DRAFT_KEY = 'lets.mors.draft';
const AWAY_EVERY = 30000;
const RESUME_WINDOW = 8000;
const RENDER_MAX = 300;
const GHOST_MAX = 60;
const UNDO_MAX = 50;
const TEXT_MAX = 1000;
const CHANGED_MS = 600;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

const $ = (id) => document.getElementById(id);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = null) => (Number.isFinite(+v) ? Math.floor(+v) : d);
const num = (v, d = null) => (Number.isFinite(+v) ? +v : d);
const isEditable = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  || (el.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color|image)$/i.test(el.type)));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const preview = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Creates an element. attrs: class, text, on<event> functions; anything else is an attribute. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') el.append(kid);
  return el;
}

/** Trailing debounce with `.flush()` and `.cancel()`. */
function debounce(fn, ms) {
  let t = 0;
  const d = () => { clearTimeout(t); t = setTimeout(() => { t = 0; fn(); }, ms); };
  d.flush = () => { if (t) { clearTimeout(t); t = 0; fn(); } };
  d.cancel = () => { clearTimeout(t); t = 0; };
  return d;
}

/** Ghost text → the characters to key: letters, digits and signs from the table, single spaces; ≤ 60. */
function ghostChars(text) {
  const out = [];
  for (const ch of String(text ?? '').toUpperCase()) {
    if (/\s/.test(ch)) { if (out.length && out[out.length - 1] !== ' ') out.push(' '); }
    else if (TABLE[ch]) out.push(ch);
    if (out.length >= GHOST_MAX) break;
  }
  while (out.length && out[out.length - 1] === ' ') out.pop();
  return out;
}

// ───────────────────────────── 2. boot ─────────────────────────────

let ShellApi = null;
try {
  const mod = await import('/sdk/lets-shell.js');
  ShellApi = mod.Shell || mod.default || null;
} catch (err) {
  console.warn('[mors] /sdk/lets-shell.js unavailable — running without the shell:', err?.message || err);
}

const lets = Lets.connect({ unique: 'mors', version: VERSION, caps: CAPS });
const bootAt = performance.now();

const app = $('app');
const statusDot = $('status-dot');
const wpmVal = $('wpm-val');
const wpmAuto = $('wpm-auto');
const btnSend = $('btn-send');
const btnSound = $('btn-sound');
const btnHelp = $('btn-help');
const spellForm = $('spell');
const spellInput = $('spell-input');
const rowYou = $('row-you');
const rowClaude = $('row-claude');
const trackClaude = $('track-claude');
const tapeEmpty = $('tape-empty');
const readout = $('readout');
const panel = $('panel');
const sayitForm = $('sayit');
const sayitInput = $('sayit-input');
const grid = $('grid');
const btnUndoLetter = $('btn-undo-letter');
const btnClear = $('btn-clear');
const speedEl = $('speed');
const speedVal = $('speed-val');
const autoEl = $('auto');
const soundEl = $('sound');
const btnChart = $('btn-chart');
const askForm = $('askform');
const askInput = $('ask-input');
const lampEl = $('lamp');
const keyBtn = $('key');
const stCount = $('st-count');
const stWpm = $('st-wpm');
const stGhost = $('st-ghost');
const stReadback = $('st-readback');
const stPlay = $('st-play');
const chartEl = $('chart');
const chartCols = $('chart-cols');
const btnChartClose = $('btn-chart-close');
const helpEl = $('help');
const dToast = $('d-toast');
const srLive = $('sr-live');

// ───────────────────────────── 3. state ─────────────────────────────

/** @type {Array<{m:string, c:string, ok:boolean}|{gap:true}>} the human's message */
let msg = [];
/** @type {Array<{m:string, c:string, ok:boolean}|{gap:true}>} Claude's track */
let reply = [];
/** @type {{m:string}|null} the letter Claude is keying on his track right now */
let replyOpen = null;
/** @type {string} the letter being keyed for the human by the player (Tab, insert, Say it) */
let assistOpen = '';
let assisting = false;
let rev = 1;
const textAt = new Map();
/** @type {null|{rev:number, text:string, chars:string[], keyed:number, anchor:number, reason:string|null}} */
let ghost = null;
let armed = null;
const stats = { dots: 0, dashes: 0, letters: 0, words: 0, errors: 0, typed: 0, assisted: 0, ghostsAccepted: 0, ghostsRejected: 0 };
let view = { controller: 'key', readback: false, chart: false };
const undo = [];
let changedBy = null;
let lastChangedMorse = '';
let lastAway = 0;
let loadedAt = 0;
let erasedFlash = 0;

let prefs = { sound: true, wpm: 12, auto: true, view: { controller: 'key', readback: false, chart: false } };
try { const raw = localStorage.getItem(PREFS_KEY); if (raw) { const p = JSON.parse(raw); if (isObj(p)) prefs = { ...prefs, ...p, view: { ...prefs.view, ...(isObj(p.view) ? p.view : {}) } }; } } catch { /* storage unavailable */ }
view = { controller: prefs.view.controller === 'full' ? 'full' : 'key', readback: !!prefs.view.readback, chart: !!prefs.view.chart };
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sound: prefs.sound, wpm: prefs.wpm, auto: prefs.auto, view })); } catch { /* ignore */ } }
function saveDraft() { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ morse: toMorse(msg), reply: toMorse(reply), at: Date.now() })); } catch { /* ignore */ } }

const text = () => toText(msg);
const morse = () => toMorse(msg);
const letters = () => msg.reduce((a, t) => a + (t.gap ? 0 : 1), 0);
const words = () => msg.reduce((a, t, i) => a + (!t.gap && (i === 0 || msg[i - 1].gap) ? 1 : 0), 0);
function lastWord() {
  let i = msg.length - 1;
  while (i >= 0 && msg[i].gap) i--;
  const out = [];
  while (i >= 0 && !msg[i].gap) { out.unshift(msg[i]); i--; }
  return out;
}

function bumpRev() { rev++; textAt.set(rev, text()); if (textAt.size > 60) textAt.delete(textAt.keys().next().value); }
function pushUndo() { undo.push(msg.map((t) => ({ ...t }))); while (undo.length > UNDO_MAX) undo.shift(); }

// ───────────────────────────── 4. message ops ─────────────────────────────

/** A closed letter lands on the tape. */
function commitLetter(group, { by = 'human', assisted = false } = {}) {
  if (isError(group)) { eraseWordByError(); return; }
  if (countElements(msg) + group.length > MAX_ELEMENTS || text().length >= TEXT_MAX) { toast('The tape is full. Send it, or clear some.', 'warn'); return; }
  const d = decodeGroup(group);
  msg.push({ m: group, c: d.char, ok: d.known });
  stats.letters++;
  if (assisted) stats.assisted++;
  if (d.char === '<AR>') arm('AR'); else if (d.char === '<SK>') arm('SK'); else arm(null);
  if (d.char === '<SOS>') react('startled');
  bumpRev();
  if (by === 'human') matchGhostLetter(d.char);
  renderAll();
  saveDraft();
}

/** The word gap: a settled change. */
function closeWord({ by = 'human', settle = true } = {}) {
  if (!msg.length || msg[msg.length - 1].gap) { if (settle && by === 'human') emitChanged.flush(); return; }
  const w = toText(lastWord());
  msg.push({ gap: true });
  stats.words++;
  if (w === 'K') arm('K');
  if (w === 'SOS') react('startled');
  bumpRev();
  if (by === 'human') matchGhostGap();
  renderAll();
  saveDraft();
  if (settle) { changedBy = by; emitChanged.flush(); emitChangedNow(by); }
  else scheduleChanged(by);
}

function arm(sign) {
  armed = sign;
  btnSend.classList.toggle('armed', !!sign);
  btnSend.title = sign ? `${sign === 'K' ? 'Over' : sign === 'AR' ? 'End of message' : 'End of contact'}: Enter sends to Claude` : 'Send the message to Claude (Ctrl+Enter)';
}

/** Backspace: the last element of the open letter, or the last letter. */
function eraseBack() {
  if (assisting) return;
  if (keyer.open) {
    keyer.open = keyer.open.slice(0, -1);
    if (!keyer.open) keyer.dropOpen(); else keyer.pause();
    renderAll();
    return;
  }
  if (!msg.length) return;
  pushUndo();
  let t = msg.pop();
  if (t.gap && msg.length) t = msg.pop();
  afterErase('human');
}
/** Ctrl+Backspace: the last word. */
function eraseWord() {
  if (assisting) return;
  keyer.dropOpen();
  if (!msg.length) return;
  pushUndo();
  while (msg.length && msg[msg.length - 1].gap) msg.pop();
  while (msg.length && !msg[msg.length - 1].gap) msg.pop();
  afterErase('human');
}
/** The error prosign: the word being keyed goes (or the previous one when the word was empty). */
function eraseWordByError() {
  stats.errors++;
  pushUndo();
  if (msg.length && msg[msg.length - 1].gap) msg.pop();
  while (msg.length && !msg[msg.length - 1].gap) msg.pop();
  react('oops');
  erasedFlash = Date.now();
  setTimeout(() => renderTape(), 1100);
  afterErase('human');
}
function eraseAll(by = 'human') {
  if (assisting) stopAssist();
  keyer.dropOpen();
  if (!msg.length) { renderAll(); return; }
  pushUndo();
  msg = [];
  if (ghost) dropGhost('cleared');
  afterErase(by);
}
function afterErase(by) {
  arm(null);
  bumpRev();
  if (ghost) {
    if (msg.length < ghost.anchor) dropGhost('cleared');
    else ghost.keyed = Math.min(ghost.keyed, countKeyedTokens());
  }
  renderAll();
  saveDraft();
  scheduleChanged(by);
}
/** How many ghost characters the tokens after the anchor still match. */
function countKeyedTokens() {
  if (!ghost) return 0;
  let k = 0;
  for (let i = ghost.anchor; i < msg.length && k < ghost.chars.length; i++) {
    const t = msg[i];
    const want = ghost.chars[k];
    if (t.gap) { if (want === ' ') k++; continue; }
    if (want === ' ' && ghost.chars[k + 1] === t.c) k += 2;
    else if (want === t.c) k++;
    else break;
  }
  return k;
}
function undoLast() {
  if (assisting) return;
  const snap = undo.pop();
  if (!snap) { toast('Nothing to undo.', 'info', 1500); return; }
  keyer.dropOpen();
  msg = snap;
  arm(null);
  bumpRev();
  if (ghost) { if (msg.length < ghost.anchor) dropGhost('cleared'); else ghost.keyed = Math.min(ghost.chars.length, countKeyedTokens()); }
  renderAll();
  saveDraft();
  scheduleChanged('human');
}

// ───────────────────────────── 5. ghost ─────────────────────────────

function setGhost(ghostRev, textIn, reason, { silent = false } = {}) {
  const chars = ghostChars(textIn);
  if (!chars.length) { if (ghost) { ghost = null; renderAll(); } return; }
  // the anchor is the end of the message; a gap at the end is the start of the next word
  ghost = { rev: ghostRev ?? rev, text: chars.join(''), chars, keyed: 0, anchor: msg.length, reason: reason || null };
  if (!silent) srLive.textContent = `Spell: ${ghost.text}`;
  renderAll();
}
function dropGhost(reason) {
  if (!ghost) return;
  const g = ghost;
  ghost = null;
  stats.ghostsRejected++;
  lets.emit('mors.ghost.reject', { rev, reason, keyed: g.keyed });
  renderAll();
}
function finishGhost() {
  if (!ghost) return;
  const g = ghost;
  ghost = null;
  stats.ghostsAccepted++;
  lets.emit('mors.ghost.accept', { rev, text: g.text, assisted: stats.assisted });
  react('wink');
  renderAll();
}
function matchGhostLetter(c) {
  if (!ghost) return;
  let want = ghost.chars[ghost.keyed];
  if (want === ' ') { ghost.keyed++; want = ghost.chars[ghost.keyed]; }   // a missing word gap is forgiven
  if (want === c) { ghost.keyed++; if (ghost.keyed >= ghost.chars.length) finishGhost(); }
  else dropGhost('keyed-away');
}
function matchGhostGap() {
  if (!ghost) return;
  if (ghost.chars[ghost.keyed] === ' ') { ghost.keyed++; if (ghost.keyed >= ghost.chars.length) finishGhost(); }
}
/** Tab: key the ghost's next letter for the human; Shift+Tab: the rest. */
async function keyGhost(how) {
  if (!ghost || assisting) return;
  if (keyer.open) keyer.flush();
  const g = ghost;
  const steps = how === 'rest' ? g.chars.length - g.keyed : 1;
  const seq = [];
  for (let i = 0; i < steps && g.keyed + i < g.chars.length; i++) {
    const c = g.chars[g.keyed + i];
    seq.push(c === ' ' ? { gap: true } : { m: TABLE[c], c, ok: true });
  }
  await assistPlay(seq, { by: 'human', assisted: true });
  if (ghost === g && g.keyed >= g.chars.length) finishGhost();
}

// ───────────────────────────── 6. the key, sound and lamp ─────────────────────────────

const audio = { ctx: null, gains: {} };
function ensureAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {}); return audio.ctx; }
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    audio.ctx = new C();
    for (const [track, f] of [['you', 700], ['claude', 520]]) {
      const o = audio.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = audio.ctx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(audio.ctx.destination);
      o.start();
      audio.gains[track] = g;
    }
  } catch (err) { console.warn('[mors] no audio:', err?.message || err); audio.ctx = null; }
  return audio.ctx;
}
function toneOn(track) {
  if (!prefs.sound) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const g = audio.gains[track].gain;
  const t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0.16, t + 0.005);
}
function toneOff(track) {
  if (!audio.ctx) return;
  const g = audio.gains[track].gain;
  const t = audio.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0, t + 0.005);
}

const lamp = { you: false, claude: false };
function setLamp(track, on) {
  lamp[track] = !!on;
  lampEl.dataset.on = lamp.you ? 'you' : lamp.claude ? 'claude' : 'off';
}

const keyer = new Keyer({
  unit: wpmToUnit(prefs.wpm), auto: prefs.auto,
  onElement: (el) => { if (el === '.') stats.dots++; else stats.dashes++; renderTape(); },
  onLetter: (g) => commitLetter(g),
  onWord: () => closeWord({ by: 'human', settle: true }),
  onUnit: () => { renderChip(); },
});

/** A press begins. `at` is the event's timeStamp when known: it is set by the input pipeline, so a slow handler never stretches a dot into a dash. */
function pressStart(at) {
  if (assisting) { toast('Keying for you. One moment.', 'info', 1200); return; }
  if (!keyer.press(Number.isFinite(at) && at > 0 ? at : undefined)) return;
  setLamp('you', true);
  toneOn('you');
  keyBtn.setAttribute('aria-pressed', 'true');
}
function pressEnd(at) {
  if (!keyer.down) return;
  keyer.release(Number.isFinite(at) && at > 0 ? at : undefined);
  setLamp('you', false);
  toneOff('you');
  keyBtn.setAttribute('aria-pressed', 'false');
}
/** A typed dot or dash (. - _ keys, Enter on the key): no press, a short flash. */
function typedElement(el) {
  if (assisting) return;
  if (!keyer.typed(el)) return;
  stats.typed++;
  setLamp('you', true);
  toneOn('you');
  setTimeout(() => { if (!keyer.down) { setLamp('you', false); toneOff('you'); } }, el === '.' ? TYPED_UNIT * 0.6 : TYPED_UNIT * 1.6);
}

keyBtn.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  try { keyBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  pressStart(e.timeStamp);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) keyBtn.addEventListener(ev, (e) => pressEnd(e.timeStamp));
keyBtn.addEventListener('click', (e) => e.preventDefault());
keyBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); typedElement('.'); } });
window.addEventListener('blur', () => pressEnd());

function setSound(on) {
  prefs.sound = !!on;
  app.dataset.sound = prefs.sound ? 'on' : 'off';
  btnSound.setAttribute('aria-pressed', String(prefs.sound));
  soundEl.checked = prefs.sound;
  if (!prefs.sound) { toneOff('you'); toneOff('claude'); }
  savePrefs();
}
function setSpeed({ wpm, unit, auto }) {
  if (unit != null) keyer.setUnit(unit);
  else if (wpm != null) keyer.setWpm(wpm);
  if (auto != null) { keyer.auto = !!auto; prefs.auto = keyer.auto; }
  prefs.wpm = unitToWpm(keyer.unit);
  renderChip();
  savePrefs();
}

// ───────────────────────────── 7. the player ─────────────────────────────

/**
 * Plays a schedule on a track with lamp and tone. Returns {promise, cancel}.
 * onElement(step) when a dot/dash starts; onLetterEnd(step) when a letter's last element ends; onGap() on a word gap.
 */
function runSchedule(items, unit, track, { onElement, onLetterEnd, onGap, silent } = {}) {
  let cancelled = false;
  let timer = 0;
  const promise = new Promise((resolve) => {
    let i = 0;
    const step = () => {
      if (cancelled) { resolve(false); return; }
      if (i >= items.length) { resolve(true); return; }
      const it = items[i++];
      if (it.kind === 'dot' || it.kind === 'dash') {
        onElement?.(it);
        setLamp(track, true);
        if (!silent) toneOn(track);
        timer = setTimeout(() => {
          setLamp(track, false);
          toneOff(track);
          const next = items[i];
          if (!next || next.kind !== 'gap') onLetterEnd?.(it);
          step();
        }, it.units * unit);
      } else {
        if (it.kind === 'wgap') onGap?.();
        timer = setTimeout(step, it.units * unit);
      }
    };
    step();
  });
  return { promise, cancel: () => { cancelled = true; clearTimeout(timer); setLamp(track, false); toneOff(track); } };
}

// Claude's track
const playQueue = [];
let current = null;
function enqueuePlay(item) {
  playQueue.push(item);
  if (!current) nextPlay();
}
function stopPlays() {
  playQueue.length = 0;
  if (current) { current.run.cancel(); current = null; }
  replyOpen = null;
  app.dataset.playing = 'false';
  renderTape();
  renderStatus();
}
async function nextPlay() {
  const item = playQueue.shift();
  if (!item) { current = null; app.dataset.playing = 'false'; renderStatus(); return; }
  app.dataset.playing = 'true';
  trackClaude.hidden = false;
  renderStatus();
  const started = performance.now();
  const items = schedule(item.tokens);
  if (reply.length && !reply[reply.length - 1].gap && item.tokens.length && !item.tokens[0].gap) {
    // a new play after a previous one on the same track starts a new word
    reply.push({ gap: true });
  }
  const run = runSchedule(items, item.unit, 'claude', {
    silent: item.silent,
    onElement: (s) => { if (!replyOpen) replyOpen = { m: '' }; replyOpen.m += s.kind === 'dot' ? '.' : '-'; renderTape(); },
    onLetterEnd: (s) => { const t = item.tokens[s.token]; reply.push({ m: t.m, c: t.c, ok: t.ok }); replyOpen = null; renderTape(); saveDraft(); },
    onGap: () => { if (reply.length && !reply[reply.length - 1].gap) reply.push({ gap: true }); renderTape(); },
  });
  current = { item, run };
  const ok = await run.promise;
  if (current && current.run === run) current = null;
  replyOpen = null;
  renderTape();
  if (ok) {
    lets.emit('mors.played', { id: item.id, morse: toMorse(item.tokens), ms: Math.round(performance.now() - started) });
    react('nod');
  }
  nextPlay();
}

// assisted keying on the human's track (Tab, Say it, mors.insert with play)
let assistRun = null;
async function assistPlay(tokens, { by = 'human', assisted = false } = {}) {
  if (assisting) return false;
  if (!tokens.length) return true;
  if (keyer.open) keyer.flush();
  keyer.pause();                 // the assisted letters belong to the current word: no gap timer while they play
  assisting = true;
  assistOpen = '';
  const items = schedule(tokens);
  assistRun = runSchedule(items, keyer.unit, 'you', {
    onElement: (s) => { assistOpen += s.kind === 'dot' ? '.' : '-'; if (s.kind === 'dot') stats.dots++; else stats.dashes++; renderTape(); },
    onLetterEnd: () => { const g = assistOpen; assistOpen = ''; commitLetter(g, { by, assisted }); },
    onGap: () => closeWord({ by, settle: false }),
  });
  const ok = await assistRun.promise;
  assistRun = null;
  assisting = false;
  assistOpen = '';
  keyer.touch();                 // the word closes after a word gap of silence from here, like a hand-keyed one
  renderTape();
  if (ok) scheduleChanged(by);
  return ok;
}
function stopAssist() { if (assistRun) assistRun.cancel(); assisting = false; assistOpen = ''; }

// ───────────────────────────── 8. outgoing events ─────────────────────────────

function changedPayload(by) {
  const m = morse();
  const payload = { rev, morse: m, text: text(), letters: letters(), words: words(), wpm: unitToWpm(keyer.unit), unit: keyer.unit, view: { ...view }, by };
  if (lastChangedMorse && m.length > lastChangedMorse.length && m.startsWith(lastChangedMorse)) {
    const suffix = m.slice(lastChangedMorse.length).replace(/^[\s/]+/, '');
    if (suffix) payload.delta = { morse: suffix, text: toText(parse(suffix)) };
  }
  lastChangedMorse = m;
  return payload;
}
function emitChangedNow(by) { lets.emit('mors.changed', changedPayload(by)); }
const emitChanged = debounce(() => { const by = changedBy || 'human'; changedBy = null; emitChangedNow(by); }, CHANGED_MS);
function scheduleChanged(by) { changedBy = changedBy === 'human' ? 'human' : by; emitChanged(); }

function endsSign() {
  let i = msg.length - 1;
  while (i >= 0 && msg[i].gap) i--;
  if (i < 0) return null;
  if (msg[i].c === '<AR>') return 'AR';
  if (msg[i].c === '<SK>') return 'SK';
  if (toText(lastWord()) === 'K') return 'K';
  return null;
}
function snapshotPayload() {
  const t = text();
  const out = {
    label: `${preview(t, 60) || 'empty'} · mors`,
    morse: morse(), text: t, letters: letters(), words: words(), wpm: unitToWpm(keyer.unit),
    view: { ...view }, reply: toMorse(reply), stats: { ...stats },
  };
  const e = endsSign();
  if (e) out.ends = e;
  return out;
}

function sendToClaude() {
  if (assisting) return;
  keyer.flush();
  if (!msg.length) { toast('Nothing keyed yet.', 'info', 1800); return; }
  emitChanged.flush();
  lets.emitNow('mors.export', snapshotPayload());
  if (lets.status !== 'open') { toast('Not connected to the lets host. The message is kept and sent when the connection is back.', 'warn', 4500); return; }
  toast('Sent to Claude.', 'ok', 2200);
  react('cheer');
  awayToast('Doto is away. Claude reads this with your next message in Claude Code.');
}

function sendAsk(kind, question, source) {
  const q = String(question || '').trim().slice(0, 500);
  if (!q) return;
  if (lets.status !== 'open') { toast('Not connected to the lets host.', 'warn'); return; }
  if (keyer.open) keyer.flush();
  emitChanged.flush();
  lets.emitNow('mors.ask', { kind, question: q, morse: morse(), text: text(), rev, view: { ...view }, source });
  if (kind === 'free') { try { shell.chat?.append?.('you', q); shell.chat?.open?.(); } catch { /* optional */ } }
  awayToast('Doto is away. Claude answers with your next message in Claude Code.');
}

function openSpell() {
  spellForm.hidden = false;
  spellInput.value = '';
  spellInput.focus();
}
function closeSpell() {
  if (spellForm.hidden) return;
  spellForm.hidden = true;
  keyBtn.focus({ preventScroll: true });
}
spellForm.addEventListener('submit', (e) => { e.preventDefault(); const q = spellInput.value; closeSpell(); sendAsk('spell', q, 'menu'); });
spellInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSpell(); } });
askForm.addEventListener('submit', (e) => { e.preventDefault(); const q = askInput.value; askInput.value = ''; sendAsk('free', q, 'form'); });
sayitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = sayitInput.value.trim();
  if (!t) return;
  const tokens = encodeTokens(t);
  if (!tokens.length) { toast('Nothing in there I can key.', 'info', 1800); return; }
  sayitInput.value = '';
  stats.typed += tokens.filter((x) => !x.gap).length;
  pushUndo();
  await assistPlay(tokens, { by: 'human' });
});

function setView(patch, by) {
  const next = { ...view };
  if (patch.controller === 'key' || patch.controller === 'full') next.controller = patch.controller;
  if (typeof patch.readback === 'boolean') next.readback = patch.readback;
  if (typeof patch.chart === 'boolean') next.chart = patch.chart;
  const changed = next.controller !== view.controller || next.readback !== view.readback || next.chart !== view.chart;
  view = next;
  applyView();
  if (changed) lets.emit('mors.mode', { view: { ...view }, by });
  return changed;
}

// ───────────────────────────── 9. incoming commands ─────────────────────────────

const COMMANDS = {
  'mors.suggest': (d) => {
    const t = typeof d.text === 'string' ? d.text : '';
    const r = int(d.rev);
    if (!t.trim()) { if (ghost) { ghost = null; renderAll(); } return; }
    if (r != null && r !== rev && textAt.get(r) !== text()) return;      // stale: silence
    setGhost(r ?? rev, t, typeof d.reason === 'string' ? d.reason.slice(0, 40) : null);
  },
  'mors.play': (d) => {
    const hasText = typeof d.text === 'string';
    const hasMorse = typeof d.morse === 'string';
    if (!hasText && !hasMorse) throw new Error('expected {text} or {morse}');
    const tokens = hasText && d.text.trim() ? encodeTokens(d.text) : hasMorse && d.morse.trim() ? parse(d.morse) : [];
    if (!tokens.length) { stopPlays(); return; }
    if (countElements(tokens) > MAX_ELEMENTS) throw new Error('too long to play');
    const unit = d.wpm != null ? wpmToUnit(d.wpm) : keyer.unit;
    enqueuePlay({ id: typeof d.id === 'string' ? d.id.slice(0, 60) : `p_${Date.now().toString(36)}`, tokens, unit, silent: !!d.silent });
  },
  'mors.insert': async (d) => {
    const hasText = typeof d.text === 'string';
    const hasMorse = typeof d.morse === 'string';
    if (!hasText && !hasMorse) throw new Error('expected {text} or {morse}');
    const tokens = hasText ? encodeTokens(d.text) : parse(d.morse);
    if (!tokens.length) throw new Error('nothing to insert');
    if (countElements(msg) + countElements(tokens) > MAX_ELEMENTS) throw new Error('the tape is full');
    if (assisting) throw new Error('already keying');
    pushUndo();
    if (d.play === false) {
      if (keyer.open) keyer.flush();
      if (msg.length && !msg[msg.length - 1].gap && !tokens[0].gap) msg.push({ gap: true });
      for (const t of tokens) msg.push({ ...t });
      stats.letters += tokens.filter((x) => !x.gap).length;
      arm(null);
      bumpRev();
      renderAll();
      saveDraft();
      scheduleChanged('claude');
    } else {
      if (msg.length && !msg[msg.length - 1].gap && !tokens[0].gap) tokens.unshift({ gap: true });
      await assistPlay(tokens, { by: 'claude' });
    }
  },
  'mors.erase': (d) => {
    if (d.all === true) { eraseAll('claude'); return; }
    const n = int(d.letters) ?? int(d.words);
    if (n == null || n < 1) throw new Error('expected {letters: n} | {words: n} | {all: true}');
    if (assisting) stopAssist();
    keyer.dropOpen();
    if (!msg.length) return;
    pushUndo();
    if (int(d.letters) != null) {
      for (let i = 0; i < n && msg.length; i++) { while (msg.length && msg[msg.length - 1].gap) msg.pop(); msg.pop(); }
    } else {
      for (let i = 0; i < n && msg.length; i++) { while (msg.length && msg[msg.length - 1].gap) msg.pop(); while (msg.length && !msg[msg.length - 1].gap) msg.pop(); }
    }
    afterErase('claude');
  },
  'mors.reveal': (d) => {
    if (!('controller' in d) && !('readback' in d) && !('chart' in d)) throw new Error('expected {controller?, readback?, chart?}');
    setView(d, 'claude');
  },
  'mors.set': (d) => {
    const patch = {};
    if (d.wpm != null) { const w = num(d.wpm); if (w == null || w < 3 || w > 30) throw new Error('wpm must be 3..30'); patch.wpm = w; }
    if (d.unit != null) { const u = num(d.unit); if (u == null || u < 40 || u > 400) throw new Error('unit must be 40..400 ms'); patch.unit = u; }
    if (d.auto != null) patch.auto = !!d.auto;
    if (Object.keys(patch).length) setSpeed(patch);
    if (d.sound != null) setSound(!!d.sound);
    if (!Object.keys(patch).length && d.sound == null) throw new Error('expected {wpm?, unit?, auto?, sound?}');
  },
  'mors.load': (d) => {
    if (typeof d.morse !== 'string') throw new Error('expected {morse, wpm?, view?, reply?, ghost?}');
    loadedAt = performance.now();
    if (assisting) stopAssist();
    stopPlays();
    keyer.dropOpen();
    msg = parse(d.morse).slice(-MAX_ELEMENTS);
    while (msg.length && msg[msg.length - 1].gap) msg.pop();
    reply = typeof d.reply === 'string' ? parse(d.reply) : [];
    trackClaude.hidden = reply.length === 0;
    if (d.wpm != null && num(d.wpm) != null) setSpeed({ wpm: num(d.wpm) });
    if (isObj(d.view)) setView(d.view, 'claude');
    ghost = null;
    if (isObj(d.ghost) && typeof d.ghost.text === 'string') { setGhost(null, d.ghost.text, null, { silent: true }); if (ghost) ghost.keyed = Math.max(0, Math.min(ghost.chars.length, int(d.ghost.keyed, 0))); }
    undo.length = 0;
    arm(endsSign());
    bumpRev();
    lastChangedMorse = '';
    renderAll();
    saveDraft();
    changedBy = 'restore';
    emitChanged.flush();
    emitChangedNow('restore');
  },
  'mors.snapshot': (_d, m) => lets.emitNow('mors.snapshot', snapshotPayload(), m?.id ? { re: m.id } : undefined),
};

function runCommand(type, fn, data, m) {
  try {
    const r = fn(isObj(data) ? data : {}, m);
    if (r && typeof r.catch === 'function') r.catch((err) => console.warn('[mors]', type, err?.message || err));
  } catch (err) {
    const message = `${type}: ${err?.message || err}`;
    if (m?.ack) throw new Error(message);
    lets.emit('lip.error', { code: 'bad_request', message, re: m?.id });
    console.warn('[mors]', message);
  }
}

// ───────────────────────────── 10. rendering, companion, keyboard, start-up ─────────────────────────────

function letterEl(t, extra) {
  const el = h('span', { class: `letter${extra ? ` ${extra}` : ''}`, 'data-char': t.c, 'data-bad': t.ok === false ? '' : null, title: t.ok === false ? `${pretty(t.m)} is not in the table` : null });
  for (const e of t.m) el.append(h('i', { class: 'el', 'data-el': e === '.' ? 'dot' : 'dash' }));
  return el;
}
function fillRow(row, tokens, open, extraTail) {
  row.textContent = '';
  const frag = document.createDocumentFragment();
  let start = 0;
  let count = 0;
  for (let i = tokens.length - 1; i >= 0; i--) { if (!tokens[i].gap) count++; if (count >= RENDER_MAX) { start = i; break; } }
  if (start > 0) frag.append(h('span', { class: 'more lets-dim', text: `… ${tokens.slice(0, start).filter((t) => !t.gap).length} more` }));
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    frag.append(t.gap ? h('span', { class: 'gap-word', 'aria-hidden': 'true' }) : letterEl(t));
  }
  if (open) frag.append(letterEl({ m: open, c: decodeGroup(open).char, ok: true }, 'open'));
  if (extraTail) frag.append(extraTail);
  row.append(frag);
  row.scrollLeft = row.scrollWidth;
}
function ghostEl() {
  if (!ghost) return null;
  const g = h('span', { class: 'ghost', 'aria-hidden': 'true' });
  ghost.chars.forEach((c, i) => {
    if (c === ' ') { g.append(h('span', { class: 'ghost-gap' })); return; }
    const l = h('span', { class: `ghost-letter${i < ghost.keyed ? ' done' : ''}`, 'data-char': c });
    for (const e of TABLE[c]) l.append(h('i', { class: 'el', 'data-el': e === '.' ? 'dot' : 'dash' }));
    g.append(l);
  });
  return g;
}
function renderTape() {
  const open = assisting ? assistOpen : keyer.open;
  const tail = [];
  if (erasedFlash && Date.now() - erasedFlash < 1100) tail.push(h('span', { class: 'erased lets-dim', text: 'erased' }));
  const gh = ghostEl();
  if (gh) tail.push(gh);
  fillRow(rowYou, msg, open, tail.length ? h('span', { class: 'tail' }, ...tail) : null);
  fillRow(rowClaude, reply, replyOpen ? replyOpen.m : '', null);
  tapeEmpty.hidden = msg.length > 0 || !!open || !!ghost || reply.length > 0 || !!replyOpen;
}
function renderReadout() {
  const show = view.readback || view.controller === 'full';
  readout.hidden = !show;
  if (!show) return;
  readout.textContent = '';
  if (!msg.length && !keyer.open) { readout.append(h('span', { class: 'lets-dim', text: 'nothing yet' })); return; }
  for (const t of msg) {
    if (t.gap) readout.append(' ');
    else if (t.ok) readout.append(t.c);
    else readout.append(h('span', { class: 'bad', text: '#', title: `${pretty(t.m)} is not in the table` }));
  }
}
function renderChip() {
  const w = unitToWpm(keyer.unit);
  wpmVal.textContent = String(w);
  wpmAuto.dataset.on = String(keyer.auto);
  wpmAuto.textContent = keyer.auto ? 'auto' : 'set';
  stWpm.textContent = `${w} wpm`;
  speedEl.value = String(w);
  speedEl.setAttribute('aria-valuetext', `${w} words per minute`);
  speedVal.textContent = `${w} wpm`;
  autoEl.checked = keyer.auto;
}
function renderStatus() {
  stCount.textContent = `${plural(words(), 'word')} · ${plural(letters(), 'letter')}`;
  stGhost.textContent = ghost ? `claude${ghost.reason ? ` · ${ghost.reason}` : ''} ${ghost.keyed}/${ghost.chars.length}` : '—';
  stReadback.textContent = view.readback ? 'read-back on' : 'read-back off';
  stPlay.hidden = app.dataset.playing !== 'true';
}
function applyView() {
  app.dataset.controller = view.controller;
  app.dataset.readback = String(view.readback);
  app.dataset.chart = String(view.chart);
  panel.hidden = view.controller !== 'full';
  chartEl.hidden = !view.chart;
  btnChart.setAttribute('aria-expanded', String(view.chart));
  for (const b of chartCols.querySelectorAll('button')) b.disabled = view.controller !== 'full';
  renderReadout();
  renderStatus();
  savePrefs();
}
function renderAll() { renderTape(); renderReadout(); renderStatus(); }

function buildGrid() {
  grid.textContent = '';
  const keyIt = (m, c) => () => { if (assisting) return; pushUndo(); assistPlay([{ m, c, ok: true }], { by: 'human' }); };
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890') grid.append(h('button', { type: 'button', class: 'lk', 'data-char': c, 'aria-label': `${c}, ${pretty(TABLE[c])}`, onclick: keyIt(TABLE[c], c) }, h('b', { text: c }), h('span', { class: 'pat', text: pretty(TABLE[c]) })));
  for (const c of ['.', ',', '?', '/', '=', '+', '-', '@']) grid.append(h('button', { type: 'button', class: 'lk', 'data-char': c, 'aria-label': `${c}, ${pretty(TABLE[c])}`, onclick: keyIt(TABLE[c], c) }, h('b', { text: c }), h('span', { class: 'pat', text: pretty(TABLE[c]) })));
  for (const p of ['AR', 'SK', 'BT', 'KN', 'SOS']) grid.append(h('button', { type: 'button', class: 'lk prosign', 'data-char': p, 'aria-label': `${p}, ${pretty(PROSIGNS[p])}`, onclick: keyIt(PROSIGNS[p], decodeGroup(PROSIGNS[p]).char) }, h('b', { text: p }), h('span', { class: 'pat', text: pretty(PROSIGNS[p]) })));
}
function buildChart() {
  chartCols.textContent = '';
  for (const col of CHART) {
    const ul = h('ul');
    for (const row of col.rows) {
      const [c, p, note] = row;
      const isPattern = typeof p === 'string' && /^[.\-]+$/.test(p);
      const li = h('li');
      if (isPattern) {
        const m = p;
        const ch = PROSIGNS[c] ? decodeGroup(m).char : c;
        li.append(h('button', { type: 'button', 'aria-label': `${c}, ${pretty(m)}${note ? `, ${note}` : ''}`, disabled: true, onclick: () => { if (assisting || view.controller !== 'full') return; pushUndo(); assistPlay([{ m, c: ch, ok: true }], { by: 'human' }); } }, h('b', { text: c }), h('span', { class: 'pat', text: pretty(m) })));
      } else li.append(h('b', { text: c }), h('span', { class: 'pat', text: p }));
      if (note && isPattern) li.append(h('span', { class: 'lets-dim note', text: note }));
      ul.append(li);
    }
    chartCols.append(h('section', { class: 'chart-col' }, h('h3', { text: col.title }), ul));
  }
}

function showStatus(s) {
  statusDot.dataset.status = s;
  const t = s === 'open' ? 'Connected to Claude' : s === 'closed' ? 'Offline — everything local' : 'Connecting to Claude…';
  statusDot.setAttribute('aria-label', t);
  statusDot.parentElement.title = `mors · ${t}`;
}

let shell = { entity: null, chat: null, toast: null, listening: null };
let hasShell = false;
function react(name) { try { shell.entity?.react?.(name); } catch { /* optional */ } }
function toast(t, level = 'info', ttl = 3500) {
  if (hasShell && typeof shell.toast === 'function') { try { shell.toast(t, level, ttl); return; } catch { /* fall through */ } }
  dToast.textContent = t;
  dToast.dataset.level = level;
  dToast.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => dToast.classList.remove('on'), ttl);
}
function awayToast(t) {
  if (!hasShell || shell.listening !== false) return;
  const now = Date.now();
  if (now - lastAway < AWAY_EVERY) return;
  lastAway = now;
  toast(t, 'info', 4500);
}

function entityContext() {
  const m = morse();
  return {
    rev, text: text(), morseTail: m.slice(-200), letters: letters(), words: words(), open: keyer.open || assistOpen || null,
    wpm: unitToWpm(keyer.unit), auto: keyer.auto, view: { ...view }, ghost: ghost ? { text: ghost.text, keyed: ghost.keyed } : null,
    playing: app.dataset.playing === 'true', ends: endsSign(),
  };
}
const ran = new Map();
function once(id, fn) { const now = performance.now(); if (now - (ran.get(id) || -1e9) < 400) return; ran.set(id, now); fn(); }
function quickSuggestions() {
  return [
    { id: 'mors.readback', label: view.readback ? 'Hide the reading' : 'Read it back', hint: 'the text above the tape', run: () => once('mors.readback', () => setView({ readback: !view.readback }, 'human')) },
    { id: 'mors.spell', label: 'Spell a word for me', hint: 'Doto shows it, you key it', run: () => once('mors.spell', openSpell) },
    { id: 'mors.check', label: 'Check what I keyed', run: () => once('mors.check', () => sendAsk('check', 'check', 'menu')) },
    { id: 'mors.chart', label: view.chart ? 'Hide the chart' : 'Show the chart', run: () => once('mors.chart', () => setView({ chart: !view.chart }, 'human')) },
    { id: 'mors.full', label: view.controller === 'full' ? 'Just the key' : 'Full controller', hint: view.controller === 'full' ? '' : 'letters, type-and-key, speed', run: () => once('mors.full', () => setView({ controller: view.controller === 'full' ? 'key' : 'full' }, 'human')) },
    { id: 'mors.chat', label: 'Open chat', run: () => once('mors.chat', () => { try { shell.chat?.open?.(); } catch { /* optional */ } }) },
  ];
}
function runPick(id) { const it = quickSuggestions().find((x) => x.id === id); if (it) it.run(); }

function toggleHelp(force) {
  const on = force == null ? helpEl.hidden : !!force;
  helpEl.hidden = !on;
  btnHelp.setAttribute('aria-expanded', String(on));
}
/** Esc: the ghost first, then the innermost open thing. @returns {boolean} */
function closeOverlays() {
  if (ghost) { dropGhost('esc'); return true; }
  if (!helpEl.hidden) { toggleHelp(false); btnHelp.focus({ preventScroll: true }); return true; }
  if (view.chart) { setView({ chart: false }, 'human'); return true; }
  if (!spellForm.hidden) { closeSpell(); return true; }
  if (assisting) { stopAssist(); renderTape(); return true; }
  return false;
}

function onKeyDown(e) {
  if (e.defaultPrevented || e.isComposing) return;
  const t = e.target instanceof Element ? e.target : null;
  const inText = isEditable(t);
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { if (closeOverlays()) e.preventDefault(); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); sendToClaude(); return; }
  if (inText) return;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); return; }
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) pressStart(e.timeStamp); return; }
  if (e.key === 'Enter') { if (t === keyBtn) return; if (armed) { e.preventDefault(); sendToClaude(); } return; }
  if (e.key === 'Tab' && ghost && !mod && !e.altKey) { e.preventDefault(); keyGhost(e.shiftKey ? 'rest' : 'next'); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); if (mod) eraseWord(); else eraseBack(); return; }
  if (mod || e.altKey) return;
  if (e.key === '.' || e.key === '-' || e.key === '_') { e.preventDefault(); typedElement(e.key === '.' ? '.' : '-'); return; }
  if (e.key === '/') { e.preventDefault(); if (!assisting) keyer.wordGap(); return; }
  if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
  if (e.key.toLowerCase() === 'm') { e.preventDefault(); setSound(!prefs.sound); toast(prefs.sound ? 'Sound on.' : 'Sound off.', 'info', 1200); return; }
}
function onKeyUp(e) {
  if (e.key === ' ' && !isEditable(e.target instanceof Element ? e.target : null)) { e.preventDefault(); pressEnd(e.timeStamp); }
}

// ── start-up ──

if (ShellApi && typeof ShellApi.mount === 'function') {
  try {
    shell = ShellApi.mount(lets, { root: document.body, entity: { name: 'Doto' }, context: entityContext, quickSuggestions }) || shell;
    hasShell = true;
  } catch (err) {
    console.warn('[mors] Shell.mount failed — running without the shell:', err?.message || err);
  }
}
if (hasShell) { try { shell.entity?.onPick?.((it) => runPick(it?.id)); } catch (err) { console.warn('[mors] onPick', err); } }

for (const [type, fn] of Object.entries(COMMANDS)) lets.on(type, (data, m) => runCommand(type, fn, data, m));
lets.onStatus(showStatus);
showStatus(lets.status);

$('toolbar').addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
  if (!b || b.disabled) return;
  switch (b.dataset.act) {
    case 'send': sendToClaude(); break;
    case 'sound': setSound(!prefs.sound); break;
    case 'chat': try { shell.chat?.toggle?.(true); } catch { /* optional */ } break;
    case 'entity': try { shell.entity?.toggle?.(); } catch { /* optional */ } break;
    case 'help': toggleHelp(); break;
    default: break;
  }
});
btnUndoLetter.addEventListener('click', () => { eraseBack(); keyBtn.focus({ preventScroll: true }); });
btnClear.addEventListener('click', () => eraseAll('human'));
btnChart.addEventListener('click', () => setView({ chart: !view.chart }, 'human'));
btnChartClose.addEventListener('click', () => { setView({ chart: false }, 'human'); keyBtn.focus({ preventScroll: true }); });
speedEl.addEventListener('input', () => setSpeed({ wpm: +speedEl.value }));
autoEl.addEventListener('change', () => setSpeed({ auto: autoEl.checked }));
soundEl.addEventListener('change', () => setSound(soundEl.checked));
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

buildGrid();
buildChart();
setSound(prefs.sound);
renderChip();
applyView();

// a reload keeps the draft of this tab; a resume (mors.load within 8 s) wins over it
try {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  const d = raw ? JSON.parse(raw) : null;
  if (d && typeof d.morse === 'string' && (d.morse || d.reply) && performance.now() - bootAt < RESUME_WINDOW && !loadedAt) {
    msg = parse(d.morse);
    reply = typeof d.reply === 'string' ? parse(d.reply) : [];
    trackClaude.hidden = reply.length === 0;
    arm(endsSign());
    textAt.set(rev, text());
  }
} catch { /* ignore */ }

textAt.set(rev, text());
renderAll();
keyBtn.focus({ preventScroll: true });
