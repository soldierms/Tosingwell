# Tosingwell — notes for Claude (and humans)

A web app (TypeScript + React + Vite) for choral scores in **Tonic Sol-fa** and **Staff notation**:
read, convert both ways, check, play (Phase 2), print/PDF (Phase 3), read from photos (Phase 4).

The owner is a beginner: explain changes in plain language, keep steps small, stop after each phase for testing.

## Commands

```bash
npm install          # once
npm run dev          # app at http://localhost:5180 + photo server on 127.0.0.1:5190 (Vite proxies /api)
npm run test:vision  # photo-reading accuracy vs known answers — calls the paid API, not part of npm test
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

## Printing and PDF (Phase 3)

Rules: black on white, SVG (vector), print-only stylesheet (`@media print` in `app.css`). Never split a bar
across lines or pages; break at bar lines. Header: title, composer/arranger, "Key: G, Doh = G", time, tempo,
section name; page-number footer. Options: notation (staff / sol-fa / both), A4 or US Letter (A4 default,
remembered), portrait/landscape, which parts, all together or one part per page; title/composer/arranger
editable in the print window. Sol-fa prints in the traditional layout.

How it works:
- `shared/print/paginate.ts` — page sizes (96 px per inch), header/footer sizes, `paginate()` puts whole lines
  of music on pages (tested), header text helpers.
- `app/src/print/buildPages.ts` — draws each section once at the page's content width (VexFlow, or the sol-fa
  view via `renderToStaticMarkup`), then copies the SVG per page with a `viewBox` window onto that page's
  lines. Both renderers report each line's top/bottom (`systems`, `data-y0/y1`).
- `app/src/components/PrintDialog.tsx` — options + live preview, portalled to `<body>`; `@page` size is
  injected; `window.print()` prints. **PDF export = the browser's "Save as PDF"** (keeps vector music; PDF
  libraries would need the Bravura font embedded). `document.title` = score title so the PDF gets its name.
- Opening the app with `#print` in the address opens the print window (used to test PDF output headlessly:
  build, `vite preview`, then Chrome `--headless=new --virtual-time-budget=15000 --print-to-pdf`).
- Staff spacing between staves is computed per line from how far notes/stems reach (`staffExtent`), so
  lyrics never collide with high tenor notes. Font waiting is capped at 3 s (`app/src/render/fonts.ts`).

## Photo reading (Phase 4)

- `server/` (Express, run with tsx): `GET /api/status` ({provider, model, ready, note}), `POST /api/read-score`
  {image base64, mediaType}. Server binds 127.0.0.1 only. `server/provider.ts` picks the reader from `.env`:
  `READ_PROVIDER` (gemini|claude), else Gemini if `GEMINI_API_KEY` is set, else Claude (`ANTHROPIC_API_KEY`).
- Gemini (`server/readGemini.ts`, owner asked for a free option): REST `generateContent` with `x-goog-api-key`,
  `responseMimeType: application/json` + `responseJsonSchema` (marked deprecated in favour of `responseFormat`
  but still documented), `mediaResolution: MEDIA_RESOLUTION_HIGH`, `thinkingConfig.thinkingLevel: HIGH`,
  default model `gemini-3.8-flash` (free tier per Google's pricing page, 2026-10). Free tier: Google uses the
  content to improve its products — shown in the UI and README. Not yet tested with a real key.
- `server/read.ts`: `claude-opus-5-5` by default, streaming, `output_config.effort: "high"`, structured output
  (`json_schema` = `SCORE_READING_SCHEMA`), `fallbacks: "default"` + beta `server-side-fallback-2026-07-01`.
  Handles refusal / max_tokens / typed API errors; returns usage and cost ($4/$20 Opus 5.5, $2/$10 Sonnet 5.5 per MTok).
- Claude reports what is PRINTED (written pitch + printed accidental + length; or sol-fa text per bar); the app
  applies key signatures/accidentals (`shared/vision/toText.ts` → staff/sol-fa text → normal parsers).
  Unreadable bars become empty bars with confidence 0 (never invented). Reading notes (questions, photo
  problems, bar problems) are kept in App state and shown with the checks.
- Client: `prepareImage` (EXIF orientation, ≤2576 px long edge, JPEG, quality warnings); `PhotoPanel`;
  review = `PhotoView` (bar region boxed) beside the music + `NoteEditor` (`shared/edit/editNote.ts`) — edits
  change the Score and are written back to the text in the current format (comments in the text are lost).
- "Add as the next page" appends a reading (header removed) to the current text.
- Accuracy test images in `tests/vision/` are clean renders of our fixtures (best case). Add real photos with a
  typed answer `tests/vision/<name>.expected.<staff|solfa>.txt` to measure real-world accuracy.
- Audiveris (dedicated OMR): not added. Pros: built for printed staff notation, deterministic, MusicXML output.
  Cons: Java install + server only, weak on phone photos, no sol-fa, AGPL, merging two readings. Decide only after
  `npm run test:vision` on real photos shows staff accuracy is not good enough.

## Save, open, export, polish (Phase 5)

- `app/src/storage/library.ts`: My scores + automatic draft in `localStorage` (try/catch everywhere; private
  browsing just skips). Files: `<title>.solfa.txt` / `<title>.staff.txt` (format from the name, else guessed).
  Opening MusicXML is not supported (export only). `?example=N` skips the draft.
- Undo/redo: `replace()` in App pushes the previous {format, text} for whole-score changes (note edits,
  readings, opened files, examples, "Edit this version"); typing uses the textarea's own undo. ⌘Z outside
  text fields.
- `shared/musicxml/export.ts`: MusicXML 4.0 partwise, one part per voice. Validated against the official XSD
  (w3c/musicxml v4.0 schema + `xmllint --schema`) for both fixtures and a marks-heavy example; tests check
  well-formedness and that every bar's durations add up.
- Lazy loading: Tone.js (`audio/player`) on first Play, `PrintDialog` on first Print.
- Phone: sticky top bar with jump links (#type #photo #play #score), larger touch targets, web app manifest +
  icons in `app/public/` (Add to Home Screen; no offline service worker).

## Folder map

- `shared/model` — types, fractions, score helpers
- `shared/convert` — pitch/keys/sol-fa syllables, durations, accidental rules
- `shared/textinput` — header/directive/marks/lyrics parsing + writing, score building
- `shared/solfa` — sol-fa parser and writer · `shared/staff` — staff-text parser and writer
- `shared/analysis` — checks and summary
- `shared/playback` — play order (repeat expansion) and timed schedule · `app/src/audio` — Tone.js player
- `app/src` — React UI; `app/src/render/staffRenderer.ts` draws staff notation with VexFlow
- `shared/print` — page sizes and pagination · `app/src/print` — builds printable pages
- `shared/vision` — reading schema + reading→text · `shared/edit` — note edits · `server/` — API-key holder
- `shared/musicxml` — MusicXML export · `app/src/storage` — My scores, draft, files
- `tests/` — library tests + fixtures (each score typed in both notations)

## Status

- Phase 1 (model, sol-fa parser, staff display, two-way conversion, checks): **done**.
- Phase 2 (playback per part / all parts, play order, follow-along, speed, loop, count-in): **done**.
- Phase 3 (printing and PDF export of both notations): **done**.
- Phase 4 (photo reading, confidence flags, review/edit screen, vision test library): **done**; accuracy not yet
  measured — needs the owner's API key, then `npm run test:vision`.
- Phase 5 (save/open, MusicXML export, undo, mobile layout, lazy loading, home-screen icon): **done**.
- Ideas not built: MusicXML import, offline mode (service worker), more verses in the sol-fa view, voice-like
  playback sound.
