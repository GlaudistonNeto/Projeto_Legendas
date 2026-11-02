import * as deepl from 'deepl-node';
import type { Segment } from './types';

const BATCH_SIZE = 30;

/** Idiomas de origem aceitos pelo DeepL (Whisper → DeepL). */
const DEEPL_SOURCE: Record<string, deepl.SourceLanguageCode> = {
  ja: 'ja',
  zh: 'zh',
  yue: 'zh',
  ko: 'ko',
  id: 'id',
  pt: 'pt',
  es: 'es',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
  it: 'it',
  en: 'en',
};

function toDeeplSource(language: string): deepl.SourceLanguageCode | null {
  return DEEPL_SOURCE[language] ?? null;
}

/**
 * Traduz os segmentos para EN-US em lotes de até 30 textos. Cada requisição
 * envia também o texto vizinho como `context` (não cobrado pelo DeepL),
 * o que melhora pronomes, sujeitos omitidos (comum em japonês/chinês) e tom.
 */
export async function translateSegments(
  segments: Segment[],
  language: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Segment[]> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPL_API_KEY não definida. Configure-a no arquivo .env.');
  }

  const translator = new deepl.Translator(apiKey);
  const source = toDeeplSource(language);
  const result: Segment[] = segments.map((s) => ({ ...s }));

  for (let i = 0; i < result.length; i += BATCH_SIZE) {
    const batch = result.slice(i, i + BATCH_SIZE);
    const texts = batch.map((s) => s.text);
    const context = [
      ...result.slice(Math.max(0, i - 5), i).map((s) => s.text),
      ...result.slice(i + BATCH_SIZE, i + BATCH_SIZE + 5).map((s) => s.text),
    ].join('\n');

    let translated: deepl.TextResult[];
    try {
      translated = await translator.translateText(texts, source, 'en-US', {
        ...(context ? { context } : {}),
        preserveFormatting: true,
        splitSentences: 'nonewlines',
      });
    } catch (err) {
      if (err instanceof deepl.AuthorizationError) {
        throw new Error('Chave do DeepL inválida ou não autorizada. Verifique DEEPL_API_KEY no .env.');
      }
      if (err instanceof deepl.QuotaExceededError) {
        throw new Error('Cota do DeepL esgotada para este mês.');
      }
      throw new Error(`Falha na tradução DeepL: ${err instanceof Error ? err.message : String(err)}`);
    }

    batch.forEach((s, k) => {
      s.translation = translated[k]?.text?.trim() || s.text;
    });
    onProgress?.(Math.min(i + BATCH_SIZE, result.length), result.length);
  }

  return result;
}
