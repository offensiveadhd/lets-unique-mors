<p align="center"><img src="icon.svg" width="72" alt=""></p>
<h1 align="center">mors</h1>
<p align="center"><b>Talk in Morse.</b><br>A <a href="https://github.com/TikoTikTok/lets">lets</a> unique: one key, one tape. Key your message in dots and dashes and send it to Claude, who reads it as a prompt and does what it says. The window assumes you know Morse. Only Doto helps you craft the message, and Claude can answer in Morse on the tape.</p>

---

## Install

mors is installed from the store. It is not a default.

```
/lets store mors      # inspect → confirm
/lets:lets mors       # or /lets mors with the alias
```

Manual: clone this repo into `~/.lets/uniques/mors`, or set `LETS_UNIQUES_DIRS=<parent folder>` while developing. mors needs lets 0.4.0 or later (handoff sessions). It asks for no files and no network: the manifest declares `fs.write: []` and `net: []`.

## What you can do

| part | what it does |
|---|---|
| **Key** | A round knob, and the lamp above it. Hold the key or hold `Space`: a press shorter than 2 units is a dot, a longer one is a dash. The lamp lights and a tone sounds while you press. With `auto` on, the unit follows your hand, and the wpm chip in the toolbar shows the speed (12 wpm to start). Typed `.`, `-` and `_` add an element without a press, and `/` forces a word gap. |
| **Tape** | Your message as it grows: dots are glowing discs, dashes are glowing bars. After 2.2 units of silence the letter closes, after 5.5 the word closes and Claude hears about it. `Backspace` erases the last element or letter, `Ctrl+Backspace` the last word, `Ctrl+Z` undoes the last erase, insert or clear. Eight dots in one group (`........`) is the error prosign: it erases the word you were keying. |
| **Read-back** | Doto's *Read it back*. Off by default. It shows the decoded character above each letter group and a readout line under the tape. *Check what I keyed* asks Claude to read your tape and say what it sees. |
| **Ghost** | Doto's *Spell a word for me*. You type the words, Claude shows the letters dim after your message, each pattern with its character above. You key them: a matching letter lights and the ghost shrinks. `Tab` keys the next letter for you, `Shift+Tab` the rest, `Esc` dismisses. A letter that does not match drops the ghost. |
| **Chart** | Doto's *Show the chart*. The alphabet, the digits, the punctuation and the prosigns in one overlay. With the full controller on, each entry is a button that keys it. `Esc` closes it. |
| **Full controller** | Doto's *Full controller*. A panel with the readout, a **Say it** box (type words, `Enter` keys them at the current speed), a grid of letter buttons, **Undo letter**, **Clear**, a speed slider (3 to 30 wpm) with **auto**, **sound**, **Chart**, and an **Ask** box for a plain question to Claude. Below 700 px tall it is a bottom drawer. |
| **Claude's reply track** | Claude can talk back. A second track under yours: the lamp blinks magenta, a lower tone sounds, and the symbols appear as they play. Plays queue. Your key stays live while Doto is keying. |
| **Send to Claude** | Hands the message over as a prompt (`Ctrl+Enter`). Claude says in one line what it read, then does what the message asks, in Claude Code. End with `AR` (end of message), `SK` (end of contact) or a word `K` (over) and the button glows and takes the next `Enter`. Nothing is sent by itself. Say *continue* to bring the window back with your message and Claude's track. |
| **Keyboard** | Everything is reachable with Tab, every control has a name, and `?` lists the shortcuts. `Space` is the key, `M` toggles sound, `Esc` closes the innermost open thing, `Ctrl+Enter` sends. |

A few rules of the road:

- The window assumes you know Morse. By default it shows the key, the tape and Send, nothing else: no alphabet, no translation. Only Doto helps, and his extras (read-back, chart, full controller) stay hidden until you open them from his menu. Each one is remembered for the next window.
- A ghost is an offer. It is not in your message until you key it. A reject tells Claude to leave it alone.
- Your hand, your message. Claude appends or erases only when you ask, and `Ctrl+Z` takes it back.
- mors stores nothing on the host. The message lives in the window, in a saved session after *Send to Claude*, and in `sessionStorage` for this tab so a reload keeps it. Your preferences (sound, speed, auto, extras) sit in `localStorage`.
- Without a host, keying, read-back, the chart and the full controller still work. Send, Ask and the ghost need a host.
- If Claude is not listening, Send still exports, and the window says Doto is away. Claude picks it up with your next message in Claude Code.

## How Claude drives it

Events (up): `mors.changed`, `mors.ghost.accept|reject`, `mors.ask`, `mors.mode`, `mors.played`, `mors.export`, `mors.snapshot`.
Commands (down): `mors.suggest`, `mors.play`, `mors.insert`, `mors.erase`, `mors.reveal`, `mors.set`, `mors.load`, `mors.snapshot`.

The manifest's `session` block (`export: mors.export`, `snapshot: mors.snapshot`, `restore: mors.load`) lets the engine save a handoff and resume it.

- [GUIDE.md](GUIDE.md) is what Claude reads when it opens mors: how to decode a message, the help Doto asks for, talking Morse back, how to read a handoff, the etiquette.
- [CONTRACT.md](CONTRACT.md) is the behaviour spec: the model, every event and command with its data, the flows, the page and the sound.
- `schemas/` holds JSON Schemas for the main messages: `changed`, `ask`, `export`, `suggest`, `play` and `load`.

## Layout

```
unique.json    LIP manifest (name, entry, domains, events, commands, session, permissions)
GUIDE.md       instructions for Claude
CONTRACT.md    behaviour spec
icon.svg
schemas/       changed, ask, export, suggest, play, load; unique.schema.json (vendored)
ui/            index.html, mors.js (the window), morse.js (table, encode, decode, keyer state machine, timing),
               style.css
scripts/       validate.mjs: manifest + schema check (zero dependencies)
```

The UI uses the engine's shell at runtime (`/sdk/`). It has no build step and no dependencies. The tone is made in the browser with Web Audio, and the window never decides what your message means: Claude does that.

## Develop

```bash
# from a lets checkout; the registry looks for <dir>/mors/unique.json,
# so point it at the PARENT of a folder named "mors" (symlink or junction this repo there)
LETS_UNIQUES_DIRS=/path/to/parent node engine/bin/lets.mjs serve --open mors --verbose

node engine/bin/lets.mjs send mors.suggest '{"rev":1,"text":"HELLO"}'   # drive it from the CLI
node engine/bin/lets.mjs events                                         # drain what mors emitted
```

Validate with `node scripts/validate.mjs` here, or `node engine/bin/lets.mjs validate <this folder>` from the engine.

## License

MIT © TikoTikTok
