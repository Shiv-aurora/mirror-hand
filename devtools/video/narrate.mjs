// Dev-only: read the demo video's narration aloud with an ElevenLabs voice,
// one audio file per line of devtools/video/narration.json.
//
//   node --env-file=.env.local devtools/video/narrate.mjs <voice id> <output folder> [line numbers...]
//
// The key comes from ELEVENLABS_API_KEY in .env.local (never in this file).
// Each request is told the lines before and after it, so the voice carries
// its tone across the cuts. Nothing here ships in the app.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const [voiceId, outDir, ...only] = process.argv.slice(2);
if (!voiceId || !outDir) {
  console.error('usage: narrate.mjs <voice id> <output folder> [line numbers...]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const lines = JSON.parse(readFileSync(resolve(here, 'narration.json'), 'utf8'));
mkdirSync(outDir, { recursive: true });

const client = new ElevenLabsClient();
for (let i = 0; i < lines.length; i++) {
  const name = String(i + 1).padStart(2, '0');
  if (only.length && !only.includes(name) && !only.includes(String(i + 1))) {
    continue;
  }
  const audio = await client.textToSpeech.convert(voiceId, {
    text: lines[i],
    modelId: process.env.NARRATE_MODEL ?? 'eleven_v4',
    outputFormat: 'mp3_44100_128',
    previousText: lines.slice(Math.max(0, i - 2), i).join(' ') || undefined,
    nextText: lines[i + 1],
    voiceSettings: { stability: 0.55, similarityBoost: 0.75 },
  });
  await pipeline(Readable.fromWeb(audio), createWriteStream(resolve(outDir, `${name}.mp3`)));
  console.log(`${name} ${lines[i].length} characters`);
}
