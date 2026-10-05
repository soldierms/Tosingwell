// Chooses which AI reads the photos, from the .env file:
//   READ_PROVIDER=gemini or claude   (optional; otherwise whichever key is present, Gemini first)
//   GEMINI_API_KEY=…   GEMINI_MODEL=… (optional)
//   ANTHROPIC_API_KEY=…  READ_MODEL=… (optional)

import { DEFAULT_MODEL, readScore, type ReadResult } from './read';
import { DEFAULT_GEMINI_MODEL, readScoreGemini } from './readGemini';

export type Provider = 'gemini' | 'claude';

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
  const provider: Provider = chosen === 'claude' || chosen === 'gemini' ? chosen : hasGemini ? 'gemini' : 'claude';
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

export function readWith(info: ProviderInfo, imageBase64: string, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<ReadResult> {
  return info.provider === 'gemini' ? readScoreGemini(imageBase64, mediaType, info.model) : readScore(imageBase64, mediaType, info.model);
}
