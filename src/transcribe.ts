import fs from 'fs';
import path from 'path';
import { nodewhisper } from 'nodejs-whisper';
import type { Segment, TranscriptionResult, WhisperJsonOutput } from './types';

/** Converte nomes de idioma do Whisper ("japanese") para ISO 639-1 ("ja"). */
const LANGUAGE_NAMES: Record<string, string> = {
  japanese: 'ja',
  chinese: 'zh',
  korean: 'ko',
  english: 'en',
  cantonese: 'yue',
  vietnamese: 'vi',
  thai: 'th',
  indonesian: 'id',
  portuguese: 'pt',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  russian: 'ru',
};

export function normalizeLanguage(lang: string | undefined | null): string {
  if (!lang) return 'auto';
  const l = lang.trim().toLowerCase();
  return LANGUAGE_NAMES[l] ?? l;
}

/** Silencia logs internos de depuração do nodejs-whisper, mantendo erros. */
const SILENT_LOGGER = { debug: () => {}, error: (...args: unknown[]) => console.error(...args), log: () => {} };

function findJsonOutput(wavPath: string): string | null {
  const dir = path.dirname(wavPath);
  const base = path.basename(wavPath, path.extname(wavPath));
  const candidates = [`${wavPath}.json`, path.join(dir, `${base}.json`)];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const any = fs.readdirSync(dir).find((f) => f.startsWith(base) && f.endsWith('.json'));
  return any ? path.join(dir, any) : null;
}

/** Fallback: interpreta a saída textual "[00:00:01.000 --> 00:00:04.500]  texto". */
function parseTranscriptText(transcript: string): Segment[] {
  const re = /\[(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)\]\s*(.*)/g;
  const toSec = (h: string, m: string, s: string, ms: string) => +h * 3600 + +m * 60 + +s + +ms / 1000;
  const segments: Segment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript)) !== null) {
    const text = m[9].trim();
    if (!text) continue;
    segments.push({ id: segments.length + 1, start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text });
  }
  return segments;
}

/** Remove segmentos vazios e alucinações típicas do Whisper (repetições, legendas fantasmas). */
function cleanSegments(segments: Segment[]): Segment[] {
  const hallucinations = [
    /ご視聴ありがとうございました/,
    /チャンネル登録/,
    /字幕(由|提供|製作|制作)/,
    /请不吝点赞|訂閱|订阅/,
    /^\s*[\[(（【].*(音楽|音乐|music|拍手|applause).*[\])）】]\s*$/i,
  ];
  const out: Segment[] = [];
  for (const s of segments) {
    const text = s.text.replace(/\s+/g, ' ').trim();
    if (!text || /^[\s.,!?。、！？…・-]+$/.test(text)) continue;
    if (hallucinations.some((re) => re.test(text)) && s.end - s.start < 4) continue;
    // Repetição idêntica consecutiva (loop do decoder)
    const prev = out[out.length - 1];
    if (prev && prev.text === text && s.start - prev.end < 1) {
      prev.end = Math.max(prev.end, s.end);
      continue;
    }
    out.push({ ...s, id: out.length + 1, text });
  }
  return out;
}

export async function transcribe(
  wavPath: string,
  language: string,
  modelName = 'large-v3',

): Promise<TranscriptionResult> {
  const whisperLanguage = language === 'auto' ? 'auto' : language;

  const transcript = await nodewhisper(wavPath, {
    modelName,
    withCuda: true,
    backend: 'native',
    autoDownloadModelName: modelName,
    removeWavFileAfterTranscription: false,
    logger: console,
    whisperOptions: {
      noGpu: false,
      outputInJson: true,
      outputInSrt: false,
      outputInText: false,
      translateToEnglish: false,
      language: whisperLanguage,
      // Sem divisão por palavra: CJK não usa espaços entre palavras.
      splitOnWord: false,
      wordTimestamps: false,
    },
  });

  let segments: Segment[] = [];
  let detected: string | undefined;

  const jsonPath = findJsonOutput(wavPath);
  if (jsonPath) {
    const data = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8')) as WhisperJsonOutput;
    detected = data.result?.language;
    segments = (data.transcription ?? []).map((t, i) => ({
      id: i + 1,
      start: t.offsets.from / 1000,
      end: t.offsets.to / 1000,
      text: (t.text ?? '').trim(),
    }));
  } else if (typeof transcript === 'string') {
    segments = parseTranscriptText(transcript);
  }

  const finalLanguage = language !== 'auto' ? language : normalizeLanguage(detected);
  return { language: finalLanguage, segments: cleanSegments(segments) };
}
