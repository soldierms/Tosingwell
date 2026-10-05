// The Gemini reader with a fake Google server (no internet, no key needed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readScoreGemini } from '../server/readGemini';

const okReading = { notation: 'staff', title: 'T', composer: null, key: 'C', time: '4/4', tempo: null, parts: [], questions: [], photoProblems: [] };
const ok = (model: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(okReading) }] }, finishReason: 'STOP' }], modelVersion: model }), { status: 200 });
const busy = () => new Response(JSON.stringify({ error: { code: 503, message: 'The model is overloaded.' } }), { status: 503 });

describe('Gemini reader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.GEMINI_API_KEY = 'test-key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it('waits and tries again when Google is busy (503)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return calls.length < 3 ? busy() : ok('gemini-3.8-flash');
    }));
    const p = readScoreGemini('abc', 'image/png', 'gemini-3.8-flash');
    await vi.runAllTimersAsync();
    const r = await p;
    expect(calls.length).toBe(3);
    expect(r.reading.title).toBe('T');
    expect(r.usage.costUsd).toBe(0);
  });

  it('switches to the fallback model when the main one stays busy', async () => {
    const models: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const m = /models\/([^:]+):/.exec(url)![1];
      models.push(m);
      return m === 'gemini-3.8-flash' ? busy() : ok(m);
    }));
    const p = readScoreGemini('abc', 'image/png', 'gemini-3.8-flash');
    await vi.runAllTimersAsync();
    const r = await p;
    expect(models.filter((m) => m === 'gemini-3.8-flash').length).toBe(4);
    expect(r.model).toBe('gemini-3.5-flash');
  });

  it('gives a clear message when everything stays busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => busy()));
    const p = readScoreGemini('abc', 'image/png', 'gemini-3.8-flash');
    const result = p.catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(((await result) as Error).message).toContain('busy right now');
  });

  it('does not retry a bad key', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid.' } }), { status: 400 }));
    vi.stubGlobal('fetch', f);
    await expect(readScoreGemini('abc', 'image/png')).rejects.toThrow('not accepted');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
