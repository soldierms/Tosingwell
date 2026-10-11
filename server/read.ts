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

export { SYSTEM_PROMPT } from '../shared/vision/prompt';
import { SYSTEM_PROMPT } from '../shared/vision/prompt';

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
