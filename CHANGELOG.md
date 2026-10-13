# Changelog

## 0.1.0 — 2026-10-13

First release. mors is a window you talk through in Morse: key dots and dashes on one key, watch them on a tape, and send the message to Claude as a prompt.

- **The key and the tape:**
  - hold the key or `Space`: a press under 2 units is a dot, a longer one is a dash, with a lamp and a tone;
  - the letter closes after 2.2 units of silence and the word after 5.5, and `auto` tunes the unit to the human's hand (3 to 30 wpm, 12 wpm to start);
  - typed `.`, `-` and `_` add elements, and `/` forces a word gap;
  - the International table: letters, digits, punctuation and the prosigns `<AR>`, `<SK>` and `<SOS>`, with `#` for a group that is not in it;
  - the tape shows dots as glowing discs and dashes as glowing bars, and renders only the last 300 letters of a long message.
- **Erasing and end signs:**
  - `Backspace` erases an element or a letter, `Ctrl+Backspace` a word, `Ctrl+Z` undoes the last erase, insert or clear (50 states);
  - the error prosign (eight dots) erases the word being keyed;
  - ending with `AR`, `SK` or a word `K` makes Send glow and take the next `Enter`; the export carries the sign as `ends`.
- **Doto's help, hidden until asked:**
  - *Read it back* shows the decoded characters on the tape and a readout line;
  - *Spell a word for me* turns Claude's `mors.suggest` into a ghost of letters to key, with `Tab` to key the next letter, `Shift+Tab` the rest and `Esc` to dismiss;
  - *Check what I keyed* asks Claude to read the tape;
  - *Show the chart* opens the alphabet, and *Full controller* adds a Say it box, a letter grid, Undo letter, Clear, a speed slider, auto, sound and an Ask box;
  - each extra is remembered for the next window.
- **Claude talks back:** `mors.play` blinks a magenta lamp, sounds a lower tone and writes the symbols on a reply track under the human's. Plays queue, end with `mors.played`, and the key stays live during one.
- **Send to Claude** is a handoff. It saves a session (`session: {export: mors.export, snapshot: mors.snapshot, restore: mors.load}`), and a resumed window comes back through `mors.load` with the message and Claude's reply track.
- **Doto's menu and reactions:** *Read it back*, *Spell a word for me*, *Check what I keyed*, *Show the chart*, *Full controller* and *Open chat*. The page plays a wink when a ghost is keyed to the end, an oops on the error prosign, a cheer on Send, a nod when a play finishes and a startled look on `SOS`.
- **Events:** `mors.changed`, `mors.ghost.accept|reject`, `mors.ask`, `mors.mode`, `mors.played`, `mors.export`, `mors.snapshot`.
- **Commands:** `mors.suggest`, `mors.play`, `mors.insert`, `mors.erase`, `mors.reveal`, `mors.set`, `mors.load`, `mors.snapshot`.
- **Layout:** checked at 800×600 and at 375 px wide. Needs lets 0.4.0.
