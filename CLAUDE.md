# Tosingwell — notes for Claude (and humans)

A web app (TypeScript + React + Vite) for choral scores in **Tonic Sol-fa** and **Staff notation**:
read, convert both ways, check, play (Phase 2), print/PDF (Phase 3), read from photos (Phase 4).

The owner is a beginner: explain changes in plain language, keep steps small, stop after each phase for testing.

## Commands

```bash
npm install          # once
npm run dev          # app at http://localhost:5180 (also on the phone via the Network address)
npm test             # all unit + library tests (Vitest)
npm run typecheck    # TypeScript check
npm run build        # production build into dist/
```

## Git rules

- Run `git pull` before starting work. HTTPS remote, commit as `soldierms`.
- Commit small and often; push to `main` at the end of each phase.
- **Never commit** `.env`, API keys, tokens, or `github_pat.txt` (all in `.gitignore`).

## Architecture: one model, many views

```
typed sol-fa ─┐                         ┌─ sol-fa view / sol-fa text
typed staff  ─┼─▶  Score (shared/model) ─┼─ staff view (VexFlow SVG) / staff text
photo (Ph.4) ─┘          │               ├─ playback (Ph.2), print/PDF (Ph.3), MusicXML (Ph.5)
                         └─ checks (shared/analysis) → flags + summary
```

- `shared/` is plain TypeScript with no browser code; it is used by the app and (later) the server.
- Sol-fa and staff are **views** of the same `Score`. Never store syllables or staff positions in the model.

## The data model (`shared/model/types.ts`)

- `Score` = `meta` + `measures: MeasureInfo[]` (bar-level, shared by all parts) + `parts: Part[]` + `flags`.
- `MeasureInfo`: time sig, key at bar start, `keyChanges` (with offset, for mid-bar sol-fa modulations),
  tempo, `tempoChanges` (rit/accel/a tempo), pickup, repeatStart/End, `ending` (volta), segno, coda,
  toCoda, fine, jump (D.C./D.S. variants), double/final bar.
- `Part` (S, A, T, B): `staff` upper/lower, `stem` up/down, `measures[].events`.
- `NoteEvent`: `kind` note/rest, `pitches` (SOUNDING pitch; >1 = divisi), `duration` (exact fraction of a
  whole note; triplet eighth = 1/12), `tuplet`, `grace`, `tieToNext`, slurs, articulations, fermata,
  dynamic, hairpin, pedal, `lyrics` (verse, syllabic, extend = melisma), `bridgeFrom`, `confidence` (0–1),
  `source` (image region, Phase 4). `id` = `S-m3-e2` (part, bar index, event index).
- Durations use `shared/model/fraction.ts` — never floating point.

## Music rules

- **Movable doh.** Key sets doh; syllables are relative to it. Minor keys are lah-mode (A minor: doh = C).
- Syllables `d r m f s l t`; chromatic `de ra ri me fe se le li ta`; accepted alternates `di fi si ma la te`
  (`la` = lowered lah, `te` = lowered te, as requested by the owner).
- Octaves: `'` / `¹²` higher, `,` / `₁₂` lower. Unmarked doh is in octave 4 for keys C–G, octave 3 for
  A and B (override with header `Doh: A4`).
- **Tenor and bass sol-fa are written an octave above the sounding pitch** (`SOLFA_OCTAVE_SHIFT`).
- Sol-fa time: `|` bar, `:` (or `!`) pulse, `.` half pulse, `,` quarter pulse, `.,` = 3/4 then 1/4,
  two dots = triplet, `-` hold (across a bar = tie), blank = rest. One pulse = the time signature's
  bottom number (6/8 has six eighth-note pulses).
- Comma rule: a comma after a note is an octave mark unless another note follows in the same pulse —
  then the last comma is the quarter divider (`s,,r` = low s, r). Mid-pulse rest = a space (`d. ,r`);
  nothing between dividers means "keep holding" (`d.,r`). Divisi: `m+d`.
- Bridge notes at key changes: `[key:D]s/d`. The checker verifies old and new syllables are the same note.
- Staff accidentals (`shared/convert/accidentals.ts`): key signature applies to all octaves; an accidental
  lasts to the end of the bar, same letter and octave only; bar line cancels it; a tied note keeps it.
- Layout: S+A on treble, T+B on bass (or tenor on its own octave-treble staff, option in the UI).

## Typed formats

Both share headers (`Title/Composer/Arranger/Key/Time/Tempo/Doh`), part lines (`S: A: T: B:`, repeat to
continue), lyric lines (`S-lyrics:`, `S-lyrics-2:`; `-` joins syllables, `_` melisma, `*` skip),
bar lines (`| || |] ||: :|| :||:`), instructions in `[...]` and note marks in `{...}`. See the help panel in
the app and the header comments in `shared/solfa/parse.ts`, `shared/staff/parse.ts`,
`shared/textinput/common.ts`. Staff text: `G4q`, `F#4e.`, `Bb3h~`, `rq`, `R`, `<G4 B4>q`, `(3 C4e D4e E4e)`,
`gD5s`; pitches are SOUNDING pitches.

## Analysis checks (`shared/analysis/checks.ts`) — report, never auto-fix

bar length vs time signature (pickup and matching last bar allowed) · bar count across parts · voice
ranges (S C4–A5, A F3–D5, T C3–A4, B E2–E4) · accidentals (chromatic notes listed; low-confidence chromatic
notes warned) · ties to different notes · repeats/endings/D.C./D.S./Coda/Fine consistency · low confidence
(< 0.8) · unbalanced slurs. Parsers flag anything unreadable; **never invent notes to fill a gap**.

## Playback (Phase 2)

- `shared/playback/expand.ts` — play order from repeats, endings (incl. "1,2" + "3"), D.C./D.S., Segno,
  To Coda/Coda, Fine. End-repeat with no start → from the beginning. After a D.C./D.S. repeats are not taken
  and only the last ending plays (option "Take repeats again after D.C./D.S."). `describePlayOrder` gives the
  words shown to the user, who must tick "I have checked this order" before Play.
- `shared/playback/schedule.ts` — timed notes in seconds: tempo (number, or word → bpm guess; default q=80),
  rit./accel. (to 70% / 130% over ~2 bars, reset by a tempo/new tempo/jump), fermata = everyone waits about
  the note's length, ties joined (also across bars and repeats), dynamics → loudness, hairpins interpolate,
  accent/marcato louder, staccato 45% length, legato under slurs/tenuto, grace notes 70 ms before the beat.
  Tie continuations and rests are kept as silent entries so follow-along can highlight them.
- `app/src/audio/player.ts` — Tone.js; Salamander piano samples from tonejs.github.io (needs internet; falls
  back to a simple synth), one `Tone.Channel` per voice for solo/mute, count-in clicks, loop.
  Follow-along polls `transport.seconds` every 50 ms (do NOT use Tone.Draw — it drops late events).
- `app/src/components/PlayerPanel.tsx` — controls; loop plays the chosen bars as written (no repeats).

## Printing rules (Phase 3)

Black on white, SVG, print-only stylesheet. Never split a bar across lines/pages; break at bar lines.
Header: title, composer/arranger, "Key: G, Doh = G", time, tempo; page-number footer. Options: A4/Letter,
portrait/landscape, parts, one part per page. Sol-fa print uses the traditional layout.

## Folder map

- `shared/model` — types, fractions, score helpers
- `shared/convert` — pitch/keys/sol-fa syllables, durations, accidental rules
- `shared/textinput` — header/directive/marks/lyrics parsing + writing, score building
- `shared/solfa` — sol-fa parser and writer · `shared/staff` — staff-text parser and writer
- `shared/analysis` — checks and summary
- `shared/playback` — play order (repeat expansion) and timed schedule · `app/src/audio` — Tone.js player
- `app/src` — React UI; `app/src/render/staffRenderer.ts` draws staff notation with VexFlow
- `tests/` — library tests + fixtures (each score typed in both notations)

## Status

- Phase 1 (model, sol-fa parser, staff display, two-way conversion, checks): **done**.
- Phase 2 (playback per part / all parts, play order, follow-along, speed, loop, count-in): **done**.
- Next: Phase 3 printing and PDF export.
