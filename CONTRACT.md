# mors — build contract

The behaviour spec of **mors**, the window you talk through in Morse. The shell (companion, chat, components, toasts) and the theme are the engine's: see [docs/UI-CONTRACT.md](https://github.com/TikoTikTok/lets/blob/main/docs/UI-CONTRACT.md) in the lets repo. Engine requirement: lets **0.4.0** or later (handoff sessions). Nothing here needs a new engine endpoint.

## 0 The idea

One key. The human keys dots and dashes; a tape shows them; when the message is done, **Send to Claude** hands it over and Claude reads it as a prompt: it says in one line what it read, then does what the message asks, in the transcript.

The window assumes the human knows Morse. By default it shows the **key**, the **tape** and **Send to Claude**, nothing else: no alphabet, no translation. Only **Doto** helps. His menu is the one place to get help crafting the message: *Read it back* (show the decoded text), *Spell a word for me* (Claude shows the letters as a ghost on the tape for the human to key), *Check what I keyed*, *Show the chart* (the alphabet) and *Full controller* (letter buttons, a type-and-key box, speed, sound). Those extra controls stay hidden until he opens them.

Claude can talk Morse back: `mors.play` blinks the lamp and sounds the tone on a second track of the tape.

mors stores nothing on the host. The message lives in the window (and in a saved session after *Send to Claude*).

## 1 Model

```jsonc
{
  "rev": 7,                             // increments on every change to the message (human, Claude, restore)
  "morse": "... --- ... / -.-. --.-",   // the message: elements per letter, letters separated by " ", words by " / "
  "text": "SOS CQ",                     // the window's decode, uppercase; "#" for a group that is not in the table
  "letters": 5, "words": 2,
  "open": { "morse": "-.", "since": 1791 } | null,   // the letter being keyed right now (no letter gap yet)
  "unit": 80, "wpm": 15, "auto": true,  // ms per unit (dot length) = 1200 / wpm; auto = the unit follows the human's keying
  "sound": true,
  "view": { "controller": "key", "readback": false, "chart": false },   // "key" = the minimum; "full" = Doto's other option
  "ghost": { "rev": 7, "text": "HELLO", "keyed": 2, "reason": "spell" } | null,   // Claude's letters to key next; keyed = how many are done
  "reply": "-.-. --.- / -.-",           // Claude's track: what mors.play has played so far in this window
  "stats": { "dots": 31, "dashes": 12, "letters": 14, "words": 3, "errors": 1, "typed": 4, "assisted": 2, "ghostsAccepted": 1, "ghostsRejected": 0 }
}
```

- `morse` uses `.` and `-` only. A letter is a group of 1–8 elements (only the error sign, a run of dots, may grow longer: the keyer keeps adding dots to it instead of closing the group). `text` is the decode of `morse`, one character per group, words separated by one space. The International table covers `A–Z`, `0–9`, `. , ? ' ! / ( ) & : ; = + - _ " $ @` and the prosigns rendered as `<AR>` (`.-.-.`), `<SK>` (`...-.-`), `<SOS>` (`...---...`); `-...-` decodes as `=`, `-.--.` as `(`, `.-...` as `&`. A group not in the table decodes as `#` (the raw group stays in `morse` at the same position). `........` (8 dots or more) is the error prosign, `<HH>`: it is never kept; it erases (§4).
- `morse` and `text` are at most 4 000 elements / 1 000 characters; keying beyond that is refused with a toast.
- Timing units: dot 1, dash 3, gap inside a letter 1, between letters 3, between words 7. `unit` is clamped to 40…400 ms (30…3 wpm); the default is 100 ms (12 wpm).
- `rev` starts at 1 on an empty tape and never goes down. A load (resume) bumps it like any change.

## 2 Events (mors → Claude). Each one says what the human meant.

| type | data | the human… |
|---|---|---|
| `mors.changed` | `{rev, morse, text, letters, words, wpm, unit, view, by:"human"\|"claude"\|"restore", delta?:{morse, text}}` | finished a word (silence of a word gap after the last element), erased, cleared, or Claude's command / a restore changed the message. **Settled** message only: never while a letter is open. `delta` is what was added since the previous `mors.changed` when it was an append. |
| `mors.ghost.accept` | `{rev, text, assisted}` | keyed the whole ghost (by hand, or with Tab: `assisted` counts the letters the window keyed for them) |
| `mors.ghost.reject` | `{rev, reason:"esc"\|"keyed-away"\|"cleared", keyed}` | pressed `Esc`, keyed a letter that is not the ghost's next one, or cleared the message. `keyed` is how many letters of the ghost had matched |
| `mors.ask` | `{kind:"spell"\|"check"\|"free", question, morse, text, rev, view, source:"menu"\|"form"}` | asked Doto for help: **Spell a word for me** (`kind:"spell"`, `question` is the words they typed), **Check what I keyed** (`kind:"check"`, `question:"check"`), or typed a free question in the full controller's Ask box (`kind:"free"`). `source` is `menu` when the request came through Doto's menu (spell, check) and `form` when it came from the Ask box (free) |
| `mors.mode` | `{view, by:"human"\|"claude"}` | opened or closed one of Doto's extras: the full controller, the read-back or the chart (or Claude did with `mors.reveal`) |
| `mors.played` | `{id, morse, ms}` | nothing: a `mors.play` finished playing (`id` is the play's id) |
| `mors.export` | `{label, morse, text, letters, words, wpm, view, reply, ends?, stats}` | pressed **Send to Claude** (`Ctrl+Enter`): a handoff. `ends` is `"AR"`, `"SK"` or `"K"` when the message ends with that sign. The engine prepends `session {id, handoff, saved, summary}` |
| `mors.snapshot` | the export payload | nothing: it is the reply to the `mors.snapshot` command (`re` = command id) |

`label` is the decoded text (≤ 60 characters, `#` groups included) plus ` · mors`, e.g. `SHOW ME THE TESTS · mors`: the saved session's summary. An empty message cannot be sent (toast).

## 3 Commands (Claude → mors)

| type | data | effect |
|---|---|---|
| `mors.suggest` | `{rev, text, reason?}` | Shows `text` (letters, digits, punctuation, spaces; ≤ 60 characters, uppercased, characters not in the table dropped) as the **ghost**: dim cyan patterns with the character above each, after the end of the message. The ghost is shown when `rev` is the current one, or when the decoded text is still what it was at that `rev`; otherwise it is dropped silently. `text:""` clears. `reason` shows in the status line (`ghost: claude · spell`). A new ghost replaces the old one without a reject event. |
| `mors.play` | `{id?, text?, morse?, wpm?, silent?}` | Claude talks Morse: plays `text` (encoded) or `morse` on the **reply track**: the lamp blinks magenta, the tone sounds (lower pitch than the human's) unless `silent` or sound is off, and the symbols appear on the track as they play. `wpm` defaults to the window's. Plays queue in order; `{text:""}` stops and empties the queue; a text with nothing encodable in it is a bad request. Ends with `mors.played`. The key stays live during a play. |
| `mors.insert` | `{text?, morse?, play?}` | Appends to the human's message as `by:"claude"`: with `play` (default `true`) the window keys it at the current speed with lamp and tone (the human watches); `play:false` appends at once. Bumps `rev`, emits `mors.changed`. Undoable (`Ctrl+Z`). Ask before inserting more than a word: the message is the human's voice. |
| `mors.erase` | `{letters?, words?, all?}` | Removes from the end: `letters: n` groups, or `words: n`, or everything. A count of 0 counts as not given. Undoable. |
| `mors.reveal` | `{controller?:"key"\|"full", readback?, chart?}` | Doto's extras, from Claude's side: the full controller, the decoded text on the tape, the alphabet chart. Only the keys given change (`{}` changes nothing). Emits `mors.mode {by:"claude"}` when something changed. |
| `mors.set` | `{wpm?, unit?, auto?, sound?}` | Speed (`wpm` 3…30 or `unit` 40…400 ms; `unit` wins when both are given), whether the unit keeps following the human (`auto`), the tone on or off. |
| `mors.load` | `{morse, text?, wpm?, view?, reply?, ghost?}` | The restore command: renders the saved message (and Claude's reply track) without ghost or accept events, bumps `rev`, emits `mors.changed {by:"restore"}`. A load in the first 8 s after boot wins over the sessionStorage draft. `text` is ignored (the window decodes `morse` itself). `morse` and `reply` obey the message limits of §1; `ghost` is `{text, keyed?}` with the limits of `mors.suggest`. |
| `mors.snapshot` | `{}` | Replies with a `mors.snapshot` event. |

All commands are idempotent, animate (≤ 300 ms, transform and opacity only, except a play, which lasts as long as its message) and accept `"ack": true` on the envelope (`lip.ack {ok, error?}`). A bad command without `ack` answers `lip.error {code:"bad_request", message, re}`.

## 4 Flows

**Keying.** Pointer down on the key, or `Space` down (outside text fields), starts a press: the tone sounds, the lamp lights, the key squashes. Pointer up / `Space` up ends it: a press shorter than 2 units is a dot, otherwise a dash. The element is appended to the open letter (it pulses at the end of the tape). Silence then closes things: after **2.2 units** the letter closes (decoded, appended to the message, `rev` bumps); after **5.5 units** the word closes and `mors.changed` goes out. With `auto` on, each press tunes the unit: `unit = 0.75·unit + 0.25·(dot ? press : press / 3)`, clamped to 40…400 ms, so the window follows the human's hand; the wpm chip in the toolbar shows the result. Typed `.`, `-` or `_` append an element without a press; for typed elements the gaps are measured with a fixed 160 ms unit (letter after 350 ms, word after 880 ms) and `/` forces a word gap.

**Erasing.** `Backspace` removes the last element of the open letter (the rest of it keeps closing on silence; nothing settled changed, so no event), or, when none is open, the last letter; `Ctrl+Backspace` removes the last word; **Clear** (full controller, or `mors.erase {all:true}`) empties the tape. The error prosign (`........`, eight or more dots in one group) is the operator's own eraser: when that group closes, the window drops it **and the word being keyed** (back to the last word gap); when that word was still empty (the error came right after a word gap), the previous word goes instead. It plays `oops` and shows *erased* on the tape for a second. Every erase of settled letters bumps `rev` and emits `mors.changed`. `Ctrl+Z` undoes the last erase, insert or clear (a stack of 50 message states).

**End signs.** When a letter closes as `<AR>` (`.-.-.`) or `<SK>` (`...-.-`), or a word closes as `K`, the Send button glows and takes the next `Enter`: the human said *end of message* / *end of contact* / *over*. Nothing is sent by itself. `ends` carries the sign in the export.

**The ghost (Doto helps craft).** `mors.suggest` puts Claude's letters after the end of the message, dim, each pattern with its character above (the ghost is help, so it is always readable, even with read-back off). When a letter closes and matches the ghost's next character, that character lights and the ghost shrinks; a word gap matches a ghost space. A letter that does not match drops the ghost (`mors.ghost.reject {reason:"keyed-away"}`); so does `Esc` (`esc`) and Clear (`cleared`). An erase or an undo does not drop it: the ghost re-anchors to the end of what is left and its matched count is recomputed. `Tab` keys the ghost's next letter for the human (animated: lamp, tone, tape) as `assisted` input (when the next character is a space, `Tab` closes the word and keys the letter after it); `Shift+Tab` keys the rest of the ghost. When the last character is matched: `mors.ghost.accept {assisted}` (the letters of this ghost that Tab keyed) and a `wink`. Only one ghost at a time; no local predictor: help comes from Claude only.

**Read-back, chart, full controller (Doto's extras).** Off by default. *Read it back* shows the decoded character above each letter group on both tracks and a readout line under the tape. *Show the chart* opens the alphabet (A–Z, 0–9, punctuation, prosigns, each as a button that keys it when the full controller is on, otherwise read-only). *Full controller* replaces the hint line under the key with a panel: the readout, a **Say it** box (type words, `Enter` keys them at the current speed, as `by:"human"` with `stats.typed`), the letter grid, **Undo letter**, **Clear**, the speed slider (3…30 wpm) with **auto**, **sound**, **Chart**, and an **Ask** box (`mors.ask {kind:"free"}`). Each of the three toggles emits `mors.mode` and is remembered in `localStorage` for the next window. The toolbar has no button for any of them: Doto's menu (and `mors.reveal`) is the way in.

**Claude's reply.** `mors.play` plays on the reply track (magenta) under the human's track: symbols appear as they sound, with their characters when read-back is on. The status line says *Doto is keying…*; `mors.played` closes it. Plays queue; a human press during a play is keyed normally (the two tones differ in pitch).

**Send to Claude (handoff).** The button (or `Ctrl+Enter`) emits `mors.export`; the engine saves it as a session and closes the window; `cheer` plays. A resumed window gets `mors.load` with that payload, including the reply track.

**Away.** If the host is not connected, keying still works (everything is local); Send, Ask and the ghost need the host and toast when it is missing. If Claude is not listening (`shell.listening === false`), Send still exports, and the window says Doto is away (at most once per 30 s).

**Draft.** `sessionStorage["lets.mors.draft"]` keeps the message and the reply track for this tab (a reload keeps them). `localStorage["lets.mors"]` holds preferences: `sound`, `wpm`, `auto`, `view`. Nothing else is stored.

## 5 The page

Files: `ui/index.html`, `ui/mors.js` (the window), `ui/morse.js` (table, encode, decode, the keyer state machine, timing), `ui/style.css`.

- **Look.** Deep violet, the `--lets-*` variables re-declared as fallbacks, the dotted grid. The tape and the key are the page: large, centred, calm. Dots are glowing discs, dashes glowing bars (3× a dot), in the human's colour (`--lets-accent-3` cyan on the human's track) and magenta (`--lets-accent-2`) on Claude's track; the ghost at 45 % opacity, italic characters above it.
- **Toolbar** (sticky glass, `role="toolbar"`): the status dot, "mors", the **wpm chip** (`12 wpm · auto`, a readout; `auto` lights while the unit follows the hand), **Send to Claude** (primary); right end: sound (`M`), chat, companion, `?`.
- **Tape** (`#tape`, `role="log"`, `aria-live="polite"` for the decoded text when read-back is on): the human's track (`.track-you`) and Claude's track (`.track-claude`, hidden until the first play), each a horizontal row that scrolls to the end by itself; letters are `.letter` groups of `.el` elements with `data-el="dot|dash"`, words separated by `.gap-word` (a faint `/`). The open letter has `.open` and pulses; the ghost is `.ghost` with `.ghost-letter` items (`data-char`), the matched ones `.done`. An empty tape shows *Key something. Hold Space, or the key.* in dim text.
- **Readout** (`#readout`, under the tape, hidden unless read-back): the decoded text in a larger monospace, `#` groups shown with their raw pattern on hover.
- **The key** (`#key`, a `button`, `aria-label="Morse key: hold to key"`, `aria-pressed` while down): a round knob, 120 px (88 px below 480 px wide), on a base plate; pressing scales it to .94 and lights the **lamp** ring (`#lamp`, `data-on="you|claude|off"`). Under it the **hint line** (`#hint`): `Hold Space or the key · pause for a letter, longer for a word · Backspace erases a letter · ········ erases the word`.
- **Full controller** (`#panel`, hidden unless `view.controller === "full"`): a glass panel between the tape and the key (a bottom drawer below 700 px tall), with the readout, the Say-it form, the letter grid (`button.lk[data-char]` with the character and its pattern), Undo letter, Clear, the speed slider (`input[type=range]` 3…30), the auto, sound and Chart toggles, and the Ask form.
- **Chart** (`#chart`, a glass overlay, `aria-label="Morse chart"`): the table in five columns (letters, digits, punctuation, prosigns); `Esc` closes.
- **Status line** (`#statusline`, bottom): `3 words · 11 letters · 12 wpm · ghost: claude · spell | — · read-back off | on · Doto is keying…`.
- **Help overlay** (`?`): the shortcuts.

**Keyboard** (outside text fields unless noted)

| key | does |
|---|---|
| `Space` (hold) | the key |
| `.` `-` `_` | a typed dot or dash |
| `/` | a word gap (typed input) |
| `Backspace` / `Ctrl+Backspace` | erase the last element or letter / the last word |
| `Tab` / `Shift+Tab` (with a ghost) | key the ghost's next letter / the rest of it; without a ghost Tab moves focus as usual |
| `Esc` | dismiss the ghost; then close the innermost open thing (help, the chart, the spell box); then stop an assisted keying |
| `Enter` (Send armed by AR / SK / K) | Send to Claude |
| `Ctrl+Enter` | Send to Claude |
| `Ctrl+Z` | undo the last erase, insert or clear |
| `M` | sound on / off |
| `?` | shortcuts |
| `Ctrl+/` · `Ctrl+Space` · right-click | shell: chat · companion |

Everything is reachable with Tab in DOM order and every control has an accessible name. The key is a real button, so `Enter` on it keys a dot and `Space` on it is the key like everywhere else. A screen reader hears the decoded text through the readout's live region when read-back is on, and the ghost once when it appears ("Spell: HELLO").

## 6 Companion

- `context(info)` returns `{rev, text, morseTail (last 200 chars), letters, words, open, wpm, auto, view, ghost:{text,keyed}|null, playing, ends}`.
- `quickSuggestions(ctx)` offers, in this order: **Read it back** / **Hide the reading** (local: toggles `readback`), **Spell a word for me** (opens a one-line form under the toolbar: *What do you want to say?* → `mors.ask {kind:"spell"}`), **Check what I keyed** (`mors.ask {kind:"check"}`), **Show the chart** / **Hide the chart** (local), **Full controller** / **Just the key** (local), **Open chat**. Pick ids start with `mors.` and run once.
- Reactions, at most one per human action: `wink` when a ghost is fully keyed, `oops` on the error prosign, `cheer` on Send to Claude, `nod` when a play finishes, `startled` when a word closes as `SOS`.
- Moods are Claude's to set; the page never emits or handles `entity.*`, `chat.*`, `component.*`, `ui.*`.

## 7 Sound and lamp

Web Audio, created on the first press (browsers require a gesture). One oscillator per track: sine, 700 Hz for the human, 520 Hz for Claude, gain ramps of 5 ms so there is no click. Sound is on by default; `M`, the toolbar button, the full controller and `mors.set {sound}` turn it off; the preference persists. The lamp always works, sound or not. Under `prefers-reduced-motion` the lamp still lights (it is the signal) but the key does not squash and nothing pulses.

## 8 Quality bar

- No console errors in Chromium or Edge; the page works without the shell (no companion) and without a host (offline: keying, read-back, chart and the full controller all work; Send, Ask and the ghost need a host).
- Keying is exact to the frame: press timing comes from `performance.now()` in the pointer and key handlers, never from render timing; a 1 000-letter message scrolls without jank (the tape renders only the last 300 letters, with a *… n more* marker at the left).
- Animation uses transform and opacity only; reduced motion is honoured.
- Plain ES modules with JSDoc, no build step, no CDN, no inline `<script>` (CSP `script-src 'self'`), no `eval`, no user content through `innerHTML`.
- Looks right at 800×600 (the app's browser pane) and at 375 px wide (the toolbar wraps, the key shrinks, the full controller becomes a drawer).
