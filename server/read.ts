// Sends one photo of a score to Claude and gets back a ScoreReading (JSON that
// must match SCORE_READING_SCHEMA). Runs only on the server, so the API key
// never reaches the browser.

import Anthropic from '@anthropic-ai/sdk';
import { SCORE_READING_SCHEMA, type ScoreReading } from '../shared/vision/schema';

/** Prices per million tokens (USD), for the cost shown after each reading. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

export const DEFAULT_MODEL = 'claude-opus-5-5';

export const SYSTEM_PROMPT = `You transcribe photos of printed choral music (hymns, anthems) for an app that plays and prints them. Accuracy matters more than anything else: the app plays exactly what you report, so a wrong note is worse than a note marked as unreadable.

The page may be in staff notation or in Tonic Sol-fa. Report what is PRINTED; the app works out the meaning (it applies the key signature and accidental rules itself).

General rules
- Never guess to fill a gap. If something cannot be read (blur, glare, cut off, covered, handwriting you cannot decipher), set unreadable=true for that bar, leave out what you cannot read, and say why in "problem". Do not invent notes, rests, words or bars.
- Give every note and bar an honest confidence from 0 to 1: 1 = certain; 0.9 = clear print; 0.6–0.8 = probably right but you had to look twice (small print, ledger lines, faint accidental, crowded chord); below 0.5 = a guess you are flagging. Low confidence is useful; false certainty is harmful.
- Put anything you could not decide into "questions" (plain words a beginner understands, naming the part and bar), and photo issues into "photoProblems" (blur, glare, shadow, skew, page cut off, too far away).
- Parts: S (soprano), A (alto), T (tenor), B (bass). In a closed score, the upper staff holds S (stems up) and A (stems down); the lower staff holds T (stems up) and B (stems down). Where both voices share one notehead or a single stem has two noteheads (divisi), give both parts the note(s) that belong to them. If a score has only some parts, report only those. Every part must have the same number of bars, in the same order, including a pickup bar (number 0) if there is one.
- region: where the bar sits on the image, as fractions (0..1) of the image width/height, for the first part's staff of that bar (good enough to point the user at it).
- If the picture is not a music score, set notation="not-music" and leave parts empty.

Staff notation
- For each note give the letter and octave of the notehead as it sits on the staff in its clef (middle C = C4; treble-clef bottom line = E4; bass-clef top line = A3). If the tenor uses a treble clef with a small 8 below, set that part's clef to "treble8vb" and still report the WRITTEN octave.
- accidental: only a sharp/flat/natural printed directly before that note. Do NOT add the key signature, and do NOT repeat an earlier accidental from the same bar — the app applies both rules.
- length and dots exactly as printed; tie=true when the note is tied to the next; grace notes have grace=true; triplets/tuplets: tupletStart {actual, normal} on the first note (a triplet is actual 3, normal 2) and tupletEnd=true on the last.
- Marks: articulations, fermata, dynamic (on the note where it is printed), hairpin starts/ends, slur start/end.
- lyric: the verse-1 syllable printed under that note. Add "-" at the end if the word continues on a later note ("A-" for "A - bide"); use "_" for a note that continues the previous syllable (a melisma or extender line). Leave null when there is no syllable.
- Leave solfa and solfaLyrics null.

Tonic Sol-fa
- Copy each bar for each part into "solfa" exactly as printed, typed like this: syllables d r m f s l t; chromatic de ra ri me fe se le li ta; ":" between beats; "." for half beats; "," for quarter beats; "-" to hold; a space for a rest; octave marks as ' (up) and , (down) written straight after the syllable (a subscript 1 is ","; a superscript 1 is "'"). Two notes sung together: "m+d". A bridge note at a key change is written "s/d" (old syllable/new syllable) with "key:NEW" in directives.
- Do not include bar lines in "solfa"; give the bar's lyric words in "solfaLyrics" (syllables joined with "-" inside a word, as printed). Leave events empty.
- key: the doh as printed ("Doh is G", "Key G" → "G"; give a minor key as e.g. "E minor" if the page says lah is E).

Both notations
- directives use these words: "segno", "coda", "tocoda", "fine", "D.C.", "D.C. al Fine", "D.C. al Coda", "D.S.", "D.S. al Fine", "D.S. al Coda", "ending:1", "ending:2", "/ending" (the bar where an ending bracket closes, if it is not closed by a repeat sign), "rit", "accel", "a tempo", "key:G" (key change at this bar), "time:3/4", "tempo:Andante q=88".
- repeatStart / repeatEnd for repeat signs at the start / end of a bar; endBarline "double" or "final" when printed.
- title, composer (or arranger/source as printed), key (e.g. "G", "Eb", "E minor"), time (e.g. "4/4"), tempo (words and/or "q=90"): null when not printed.`;

export interface ReadResult {
  reading: ScoreReading;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
}

export class ReadError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

export async function readScore(imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp', model = DEFAULT_MODEL): Promise<ReadResult> {
  const client = new Anthropic();
  let message;
  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 64000,
      // Re-run on another model automatically if a safety filter wrongly declines the request.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: SCORE_READING_SCHEMA as Record<string, unknown> },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Transcribe this page of music.' },
          ],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ReadError('The API key was not accepted. Check ANTHROPIC_API_KEY in the .env file.', 401);
    if (e instanceof Anthropic.RateLimitError) throw new ReadError('Too many requests right now (rate limit). Wait a minute and try again.', 429);
    if (e instanceof Anthropic.BadRequestError) throw new ReadError(`The request was rejected: ${e.message}`, 400);
    if (e instanceof Anthropic.APIError) throw new ReadError(`The Claude API had a problem (${e.status ?? 'no status'}). Try again in a moment.`, 502);
    if (e instanceof Error && /credential|api key|apiKey/i.test(e.message)) throw new ReadError('No API key is set up yet. See "Reading photos" in README.md.', 401);
    throw e;
  }

  if (message.stop_reason === 'refusal') throw new ReadError('Claude declined to read this image. If it is a music score, try a clearer photo.', 422);
  if (message.stop_reason === 'max_tokens') throw new ReadError('The page was too long to read in one go. Photograph half a page at a time.', 422);
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let reading: ScoreReading;
  try {
    reading = JSON.parse(text) as ScoreReading;
  } catch {
    throw new ReadError('The reading came back incomplete. Please try again.', 502);
  }

  const price = PRICES[message.model] ?? PRICES[model];
  const inputTokens = message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = message.usage.output_tokens;
  const costUsd = price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
  return { reading, model: message.model, usage: { inputTokens, outputTokens, costUsd } };
}
