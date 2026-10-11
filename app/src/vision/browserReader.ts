// Photo reading straight from the browser, for the website version (no server there). Each choirmaster uses
// their OWN key, kept only in this browser (localStorage). The picture goes from the browser to the reader they
// chose — Google Gemini (free tier) or Anthropic Claude (paid) — and nowhere else.

import { SCORE_READING_SCHEMA, type ScoreReading } from '../../../shared/vision/schema';
import { SYSTEM_PROMPT } from '../../../shared/vision/prompt';

export type BrowserProvider = 'gemini' | 'claude';
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash'];
export const CLAUDE_MODEL = 'claude-opus-5-5';
const PRICES: Record<string, { input: number; output: number }> = { 'claude-opus-5-5': { input: 4, output: 20 } };

const KEY = (p: BrowserProvider) => `tosingwell.readerKey.${p}`;
const PROVIDER = 'tosingwell.readerProvider';
const safe = <T,>(f: () => T, fallback: T) => {
  try {
    return f();
  } catch {
    return fallback;
  }
};
export const getProvider = (): BrowserProvider => safe(() => (localStorage.getItem(PROVIDER) === 'claude' ? 'claude' : 'gemini'), 'gemini');
export const getKey = (p: BrowserProvider) => safe(() => localStorage.getItem(KEY(p)) ?? '', '');
export const saveReader = (p: BrowserProvider, key: string) =>
  safe(() => {
    localStorage.setItem(PROVIDER, p);
    if (key) localStorage.setItem(KEY(p), key.trim());
    else localStorage.removeItem(KEY(p));
    return true;
  }, false);

export interface BrowserReadResult {
  reading: ScoreReading;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
}

const fail = (message: string, status: number) => Object.assign(new Error(message), { status });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseReading(text: string): ScoreReading {
  try {
    const r = JSON.parse(text) as ScoreReading;
    if (!Array.isArray(r.parts)) throw new Error('no parts');
    return r;
  } catch {
    throw fail('The reading came back incomplete. Please try again.', 502);
  }
}

export async function readInBrowser(provider: BrowserProvider, key: string, imageBase64: string, mediaType: string): Promise<BrowserReadResult> {
  if (!key) throw fail('Add your reading key first (see “Reading key” above).', 401);
  return provider === 'claude' ? readClaude(key, imageBase64, mediaType) : readGemini(key, imageBase64, mediaType);
}

async function readGemini(key: string, imageBase64: string, mediaType: string): Promise<BrowserReadResult> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mediaType, data: imageBase64 } }, { text: 'Transcribe this page of music.' }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: SCORE_READING_SCHEMA,
      maxOutputTokens: 65536,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      thinkingConfig: { thinkingLevel: 'HIGH' },
    },
  };
  let lastMsg = '';
  for (const model of GEMINI_MODELS) {
    for (const wait of [0, 3000, 8000, 15000]) {
      if (wait) await sleep(wait);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
        });
      } catch {
        throw fail('Could not reach Google Gemini. Check the internet connection.', 502);
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const cand = data.candidates?.[0];
        if (data.promptFeedback?.blockReason) throw fail('Gemini declined to read this picture. Try a clearer photo.', 422);
        if (cand?.finishReason === 'MAX_TOKENS') throw fail('The page was too long to read in one go. Photograph half a page at a time.', 422);
        const text = (cand?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? '').join('');
        const u = data.usageMetadata ?? {};
        return { reading: parseReading(text), model: data.modelVersion ?? model, usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), costUsd: 0 } };
      }
      lastMsg = data.error?.message ?? `HTTP ${res.status}`;
      if ([500, 502, 503, 504].includes(res.status)) continue; // busy: wait and retry
      if (res.status === 429) break; // this model's free allowance is used up: try the next model
      if (res.status === 400 && /api key/i.test(lastMsg)) throw fail('Google did not accept this Gemini key. Check it in “Reading key”.', 401);
      if (res.status === 401 || res.status === 403) throw fail('Google did not accept this Gemini key. Check it in “Reading key”.', 401);
      throw fail(`Gemini had a problem (${res.status}: ${lastMsg}).`, res.status);
    }
  }
  if (/per.?day|daily/i.test(lastMsg)) throw fail("Today's free Gemini allowance is used up. Try again tomorrow.", 429);
  if (/minute/i.test(lastMsg)) throw fail('The free Gemini limit per minute has been reached. Wait a minute and try again.', 429);
  throw fail(`Google Gemini is busy right now (${lastMsg}). Please try again in a few minutes.`, 503);
}

async function readClaude(key: string, imageBase64: string, mediaType: string): Promise<BrowserReadResult> {
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 64000,
        stream: true,
        output_config: { effort: 'high', format: { type: 'json_schema', schema: SCORE_READING_SCHEMA } },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } }, { type: 'text', text: 'Transcribe this page of music.' }] }],
      }),
    });
  } catch {
    throw fail('Could not reach Claude. Check the internet connection.', 502);
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw fail('Anthropic did not accept this Claude key. Check it in “Reading key”.', 401);
    if (res.status === 429) throw fail('Too many requests right now. Wait a minute and try again.', 429);
    if (res.status === 529 || res.status >= 500) throw fail('Claude is busy right now. Please try again in a moment.', 503);
    throw fail(`Claude had a problem (${res.status}: ${msg}).`, res.status);
  }
  // Read the streamed answer (server-sent events).
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let text = '';
  let model = CLAUDE_MODEL;
  let stop = '';
  const usage = { input: 0, output: 0 };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.type === 'message_start') {
        model = ev.message?.model ?? model;
        usage.input = (ev.message?.usage?.input_tokens ?? 0) + (ev.message?.usage?.cache_read_input_tokens ?? 0);
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text;
      else if (ev.type === 'message_delta') {
        stop = ev.delta?.stop_reason ?? stop;
        usage.output = ev.usage?.output_tokens ?? usage.output;
      } else if (ev.type === 'error') throw fail(`Claude had a problem: ${ev.error?.message ?? 'unknown'}`, 502);
    }
  }
  if (stop === 'refusal') throw fail('Claude declined to read this picture. If it is music, try a clearer photo.', 422);
  if (stop === 'max_tokens') throw fail('The page was too long to read in one go. Photograph half a page at a time.', 422);
  const price = PRICES[model] ?? PRICES[CLAUDE_MODEL];
  return { reading: parseReading(text), model, usage: { inputTokens: usage.input, outputTokens: usage.output, costUsd: price ? (usage.input * price.input + usage.output * price.output) / 1e6 : null } };
}
