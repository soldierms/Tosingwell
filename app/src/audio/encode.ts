// Turns a recording into an MP3 file (small enough to send on WhatsApp or by email).
import { Mp3Encoder } from '@breezystack/lamejs';

export async function toMp3(buffer: AudioBuffer, onProgress?: (fraction: number) => void): Promise<Blob> {
  const channels = Math.min(2, buffer.numberOfChannels);
  const enc = new Mp3Encoder(channels, buffer.sampleRate, 128);
  // Bring the loudest moment up to about 90% so recordings are as loud as normal music on a phone.
  let peak = 0;
  for (let c = 0; c < channels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const gain = peak > 0 ? 0.9 / peak : 1;
  const toInt16 = (f: Float32Array) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i] * gain)) * 0x7fff;
    return out;
  };
  const left = toInt16(buffer.getChannelData(0));
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : undefined;
  const parts: Uint8Array[] = [];
  const block = 1152 * 20;
  for (let i = 0; i < left.length; i += block) {
    const out = enc.encodeBuffer(left.subarray(i, i + block), right?.subarray(i, i + block));
    if (out.length) parts.push(out);
    if (i % (block * 50) === 0) {
      onProgress?.(i / left.length);
      await new Promise((r) => setTimeout(r)); // keep the page responsive
    }
  }
  const end = enc.flush();
  if (end.length) parts.push(end);
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}
