# Tosingwell

A music application for reading, converting, playing and printing choral scores in **Tonic Sol-fa** and **Staff notation**.

## Planned features

1. Read and display both Tonic Sol-fa and Staff notation.
2. Convert between them in both directions.
3. Upload a photo or image of a score and read it into the app.
4. Play each voice part separately: Soprano, Alto, Tenor, Bass.
5. Play all four parts together.
6. Print any score (original or transcribed) in either notation, and export to PDF.
7. Analyze scores carefully so playback matches the written score: pitch, rhythm, repeats, dynamics and markings.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Data model, sol-fa parser, staff display, conversion both ways, automatic checks | ✅ done |
| 2 | Playback (each part / all parts), repeats and endings, follow-along, summary | ✅ done |
| 3 | Printing and PDF export | ✅ done |
| 4 | Photo upload and reading, review/edit screen | ✅ done (needs your API key) |
| 5 | Save/open, MusicXML export, mobile polish | ✅ done |

## Use it online

**https://soldierms.github.io/Tosingwell/** works on any phone or computer: type or open a score file, play each
part, print, and make rehearsal recordings. Reading photos needs the app running on your own computer (below).

## Try it

```bash
npm install
npm run dev     # starts the app AND the photo server; open http://localhost:5180
npm test        # run the tests (free, no internet needed)
```

Pick an example from the **Example** menu, or type your own score. The "How to type" link under the
text box explains the format. To listen: check the play order in the **Play** box, tick
"I have checked this order", then press **Play**. Piano sounds are loaded from the internet the first time.
To print or make a PDF, use **🖨 Print** or **⬇ Export PDF** above the score.

**Saving:** your work is saved automatically in this browser. Use **💾 Save** to keep a score in
**📚 My scores** (on this device), **⬇ Download** to keep a file you can back up or move to another device
(open it again with **📂 Open file**), and **⬇ MusicXML** to open the score in MuseScore, Finale, Sibelius or
Dorico. **↶ Undo / ↷ Redo** undo note fixes, photo readings and opened files.

**Copy and paste:** **📋 Copy** copies the score text; **📥 Paste** (or ⌘V / Ctrl+V anywhere outside the
text boxes) pastes score text — or a picture of a score, which goes straight to the photo reader. You can also
drag a picture or a `.txt` score file onto the page, or choose a picture with **📂 Open file**.

**On your phone:** open the Network address shown by `npm run dev` (same Wi-Fi), then use the browser's
**Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home screen** (Android) to get a Tosingwell icon.

## Reading photos (one-time setup)

### Printed staff music: Audiveris (free, on this Mac — the default)

[Audiveris](https://github.com/Audiveris/audiveris) is a free, open-source program built only for reading
**printed staff notation**. It runs on this computer: no internet, no API key, no daily limit, nothing sent away.

1. Download `Audiveris-<version>-macosx-arm64.dmg` (Apple Silicon) from
   <https://github.com/Audiveris/audiveris/releases>, open it, accept the licence (GNU AGPL, free), and drag
   **Audiveris.app** into Applications (or `~/Applications`). It includes its own Java.
2. For lyrics, put the English text-reading file in Audiveris's folder:
   ```bash
   curl -L -o ~/Library/Application\ Support/AudiverisLtd/audiveris/tessdata/eng.traineddata \
     https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
   ```
3. Restart the app. The photo panel says **Reader: Audiveris**.

Audiveris cannot read **sol-fa or handwriting**. Pages where it finds no staff notation are passed on to Gemini or
Claude if a key is set up (below). To use an AI reader for everything, put `READ_PROVIDER=gemini` (or `claude`)
in `.env`. Audiveris does not say how sure it is about each note: bars whose beats don't add up are flagged, but
always listen through and compare with the page.

### Sol-fa, handwriting, or an AI reader for everything

Photo reading sends the picture to an AI that can see images. You need **one** API key — choose either:

| | Google Gemini | Anthropic Claude |
|---|---|---|
| Cost | Free tier (with daily limits) | Paid: a few cents to about a dollar per page |
| Privacy | Google says free-tier content is **used to improve its products** | Not used for training by default |
| Get a key | <https://aistudio.google.com/apikey> | <https://console.anthropic.com> (add billing first) |
| `.env` line | `GEMINI_API_KEY=…` | `ANTHROPIC_API_KEY=…` |

1. Create the key on the website above and copy it.
2. In Terminal:
   ```bash
   cd ~/code/Tosingwell
   cp .env.example .env
   open -e .env
   ```
3. Paste the key after the matching `=` and save. **Never share this file**; it is in `.gitignore`, so it is
   not committed or pushed.
4. Stop and restart the app (`Ctrl+C`, then `npm run dev`). The photo panel shows which reader is in use.

If both keys are set, Gemini is used unless `.env` has `READ_PROVIDER=claude`. (With Audiveris installed, it reads
first; the key is only used for pages without staff notation.)

**Songs with several pages:** choose all the page pictures at once (in page order), or a whole **PDF** (up to
40 pages), then press **Read all … pages as one song**. Pages are read one after another and joined. If the free
limit is reached, it waits a minute by itself (per-minute limit) or stops with **Carry on from page N** (daily
limit) — the pages already read stay in the app.

Then use **Read a photo of a score**: take or choose a photo, press **Read this page**, and check the result
beside the photo. Click any note (or any empty spot in a bar) to fix it: use the buttons, type the note in
sol-fa (e.g. `d'`, `t,`, `fe`), or retype the whole bar in sol-fa (e.g. `s :s :- ! l :- :-`) — the staff
notation follows at once. Uncertain notes are orange and problem bars are red.

To measure how accurately photos are read: `npm run test:vision` (uses your key; free with Gemini's free
tier). Compare readers with `npm run test:vision -- --provider claude` or `--provider gemini`.

## Folder index

| Path | Purpose |
|------|---------|
| `README.md` | Project overview and folder index (this file) |
| `CLAUDE.md` | Detailed project notes: data model, music rules, checks, commands |
| `package.json` | Project settings, scripts and libraries |
| `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` | Build, test and TypeScript settings |
| `app/index.html` | The web page |
| `app/src/App.tsx` | Main screen: editor, summary, checks, score views, converted text |
| `app/src/components/` | `StaffView`, `SolfaView`, `SummaryPanel`, `FlagsPanel`, `PlayerPanel` (play controls), `PrintDialog` (print / PDF window), `FileBar` (new/open/save/download/undo) |
| `app/src/storage/library.ts` | My scores, automatic draft saving, file download/open |
| `app/public/` | App icon and home-screen (web app) settings |
| `app/src/print/buildPages.ts` | Builds the printed pages (header, music, page numbers) |
| `app/src/render/fonts.ts` | Waits (briefly) for the music font before drawing |
| `app/src/components/PhotoPanel.tsx` | Take/choose a photo, quality checks, send it to be read |
| `app/src/components/PhotoView.tsx`, `NoteEditor.tsx` | Review screen: original photo beside the music; fix a clicked note |
| `app/src/vision/prepareImage.ts` | Turns, shrinks and checks the photo before sending |
| `app/src/vision/pdfPages.ts` | Turns each page of a PDF into a picture (pdf.js) |
| `server/index.ts`, `server/provider.ts` | Small server that holds the API key and picks the photo reader |
| `server/read.ts`, `server/readGemini.ts` | Photo reading with Claude, or with Google Gemini |
| `scripts/vision-eval.ts` | Photo-reading accuracy test (`npm run test:vision`, uses the API) |
| `.env.example` | Template for your private `.env` file (API key) |
| `app/src/audio/player.ts` | Plays the score with Tone.js piano sounds, one channel per voice |
| `app/src/render/staffRenderer.ts` | Draws staff notation with VexFlow |
| `app/src/examples.ts` | Example scores in the Example menu |
| `app/src/styles/app.css` | Styles |
| `shared/model/` | The single score data model (`types.ts`), exact fractions, helpers |
| `shared/convert/` | Pitch, keys and sol-fa syllables; note lengths; accidental rules |
| `shared/textinput/` | Shared parts of the typed formats (headers, instructions, marks, lyrics) |
| `shared/solfa/` | Sol-fa reader (`parse.ts`) and writer (`write.ts`) |
| `shared/staff/` | Staff-text reader and writer |
| `shared/analysis/` | Automatic checks and the analysis summary |
| `shared/playback/` | Play order from repeats/D.C./D.S. (`expand.ts`) and the timed note list (`schedule.ts`) |
| `shared/print/` | Paper sizes and page breaking for printing |
| `shared/vision/` | The JSON shape Claude fills in, and turning it into a score |
| `shared/edit/` | Small note edits used by the review screen |
| `shared/musicxml/` | MusicXML export (checked against the official MusicXML 4.0 schema) |
| `tests/` | Test library and helpers |
| `tests/fixtures/` | Known scores, each typed in both sol-fa and staff notation |
| `tests/vision/` | Test images for photo reading (with their correct answers) |

_This index is updated whenever files are added._
