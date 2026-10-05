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
| 5 | Save/open, MusicXML export, mobile polish | next |

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

## Reading photos (one-time setup)

Photo reading sends the picture to Claude through Anthropic's API. This is **billed separately from a Claude
subscription** — roughly a few cents to about a dollar per page, depending on how much music is on it (the app
shows the cost after each reading).

1. Go to <https://console.anthropic.com>, sign in, add billing, and create an **API key**.
2. In Terminal:
   ```bash
   cd ~/code/Tosingwell
   cp .env.example .env
   open -e .env
   ```
3. Paste the key after `ANTHROPIC_API_KEY=` and save. **Never share this file**; it is already in `.gitignore`
   so it will not be committed or pushed.
4. Stop and restart the app (`Ctrl+C`, then `npm run dev`).

Then use **Read a photo of a score**: take or choose a photo, press **Read this page**, and check the result
beside the photo. Click any note to fix it. Uncertain notes are orange and problem bars are red.

To measure how accurately photos are read (uses the API, so it costs a little):
`npm run test:vision` — or `npm run test:vision -- --model claude-sonnet-5-5` to compare the cheaper model.

## Folder index

| Path | Purpose |
|------|---------|
| `README.md` | Project overview and folder index (this file) |
| `CLAUDE.md` | Detailed project notes: data model, music rules, checks, commands |
| `package.json` | Project settings, scripts and libraries |
| `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` | Build, test and TypeScript settings |
| `app/index.html` | The web page |
| `app/src/App.tsx` | Main screen: editor, summary, checks, score views, converted text |
| `app/src/components/` | `StaffView`, `SolfaView`, `SummaryPanel`, `FlagsPanel`, `PlayerPanel` (play controls), `PrintDialog` (print / PDF window) |
| `app/src/print/buildPages.ts` | Builds the printed pages (header, music, page numbers) |
| `app/src/render/fonts.ts` | Waits (briefly) for the music font before drawing |
| `app/src/components/PhotoPanel.tsx` | Take/choose a photo, quality checks, send it to be read |
| `app/src/components/PhotoView.tsx`, `NoteEditor.tsx` | Review screen: original photo beside the music; fix a clicked note |
| `app/src/vision/prepareImage.ts` | Turns, shrinks and checks the photo before sending |
| `server/index.ts`, `server/read.ts` | Small server that holds the API key and asks Claude to read the photo |
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
| `tests/` | Test library and helpers |
| `tests/fixtures/` | Known scores, each typed in both sol-fa and staff notation |
| `tests/vision/` | Test images for photo reading (with their correct answers) |

_This index is updated whenever files are added._
