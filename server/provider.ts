// Chooses who reads the photos, from the .env file:
//   READ_PROVIDER=audiveris, gemini or claude   (optional; otherwise Audiveris if it is installed,
//   else whichever key is present, Gemini first)
//   With Audiveris, a page with no staff notation (sol-fa, handwriting) goes on to Gemini/Claude if a key is set.
//   GEMINI_API_KEY=…   GEMINI_MODEL=… (optional)
//   ANTHROPIC_API_KEY=…  READ_MODEL=… (optional)

import { DEFAULT_MODEL, readScore, type ReadResult } from './read';
import { DEFAULT_GEMINI_MODEL, readScoreGemini } from './readGemini';
import { audiverisPath, readScoreAudiveris } from './readAudiveris';

export type Provider = 'audiveris' | 'gemini' | 'claude';

export interface ProviderInfo {
  provider: Provider;
  model: string;
  ready: boolean;
  /** Shown to the user before they send a photo. */
  note?: string;
}

export function providerInfo(override?: { provider?: Provider; model?: string }): ProviderInfo {
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasClaude = !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
  const chosen = (override?.provider ?? process.env.READ_PROVIDER?.toLowerCase()) as Provider | undefined;
  const hasAudiveris = !!audiverisPath();
  const provider: Provider =
    chosen === 'claude' || chosen === 'gemini' || chosen === 'audiveris' ? chosen : hasAudiveris ? 'audiveris' : hasGemini ? 'gemini' : 'claude';
  if (provider === 'audiveris') {
    const backup = hasGemini ? 'Google Gemini' : hasClaude ? 'Claude' : undefined;
    return {
      provider,
      model: 'Audiveris',
      ready: hasAudiveris,
      note: `Audiveris runs on this computer: free, no internet, no daily limit. It reads printed staff notation.${backup ? ` Pages without staff notation (sol-fa, handwriting) are passed on to ${backup}.` : ' It cannot read sol-fa or handwriting.'}`,
    };
  }
  if (provider === 'gemini') {
    return {
      provider,
      model: override?.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      ready: hasGemini,
      note: 'Google Gemini free tier: no charge, but Google says content sent on the free tier is used to improve its products.',
    };
  }
  return { provider, model: override?.model ?? process.env.READ_MODEL ?? DEFAULT_MODEL, ready: hasClaude };
}

export async function readWith(info: ProviderInfo, imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<ReadResult> {
  if (info.provider === 'audiveris') {
    const res = await readScoreAudiveris(imageBase64, mediaType);
    if (res.reading.parts.length) return res;
    // No staff music found: maybe sol-fa or handwriting — try an AI reader if one is set up.
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasClaude = !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
    if (!hasGemini && !hasClaude) return res;
    const ai = providerInfo({ provider: hasGemini ? 'gemini' : 'claude' });
    const aiRes = await readWith(ai, imageBase64, mediaType);
    aiRes.reading.questions.unshift('Audiveris found no staff notation on this page, so it was read by ' + (hasGemini ? 'Google Gemini' : 'Claude') + ' instead — check it carefully.');
    return aiRes;
  }
  return info.provider === 'gemini' ? readScoreGemini(imageBase64, mediaType, info.model) : readScore(imageBase64, mediaType, info.model);
}
