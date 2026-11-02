import { Ollama } from 'ollama';
import type { RefineOptions, Segment } from './types';

export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:7b';

const PROMPTS: Record<string, string> = {
  ja: [
    'あなたは日本語の音声認識（ASR）結果を校正する専門家です。',
    '入力は動画の字幕で、番号付きの行のリストです。各行の音声認識の誤りを修正してください。',
    '- 同音異義語の漢字変換ミス、助詞（は・が・を・に・で・へ・と）の誤り、送り仮名、句読点（。、）を直す。',
    '- 必ず日本語のまま出力し、翻訳・要約・説明はしない。',
    '- 意味や内容を追加・削除しない。正しい行はそのまま返す。',
    '- 行の数と番号を変えない。行を結合・分割しない。',
    '出力は JSON のみ: {"lines":[{"n":1,"text":"..."}, ...]}',
  ].join('\n'),
  zh: [
    '你是中文语音识别（ASR）结果的校对专家。',
    '输入是视频字幕，为带编号的行列表。请修正每一行中的语音识别错误。',
    '- 修正同音字/近音字错误（错别字）、词语误识别以及标点符号（，。？！）。',
    '- 保持原文的简体或繁体写法，必须用中文输出，不要翻译、总结或解释。',
    '- 不要增删内容。正确的行原样返回。',
    '- 不要改变行数和编号，不要合并或拆分行。',
    '只输出 JSON：{"lines":[{"n":1,"text":"..."}, ...]}',
  ].join('\n'),
  default: [
    'You are an expert proofreader of automatic speech recognition (ASR) output.',
    'The input is a numbered list of video subtitle lines. Fix recognition errors in each line',
    '(misheard words, homophones, punctuation) while keeping the ORIGINAL language.',
    '- Do not translate, summarize or explain. Do not add or remove content.',
    '- Keep the same number of lines and the same numbering. Do not merge or split lines.',
    'Output JSON only: {"lines":[{"n":1,"text":"..."}, ...]}',
  ].join('\n'),
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, text: { type: 'string' } },
        required: ['n', 'text'],
      },
    },
  },
  required: ['lines'],
};

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout();
      reject(new Error(`tempo limite de ${Math.round(ms / 1000)}s excedido`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Rejeita correções suspeitas (alucinação, tradução, texto muito diferente). */
function acceptCorrection(original: string, corrected: string | undefined, language: string): string {
  if (!corrected) return original;
  const c = corrected.trim();
  if (!c) return original;
  const ratio = c.length / Math.max(original.length, 1);
  if (ratio > 2 || ratio < 0.5) return original;
  // Para CJK, a correção deve continuar contendo caracteres CJK (evita tradução indevida).
  if ((language === 'ja' || language === 'zh') && /[\u3040-\u30ff\u4e00-\u9fff]/.test(original)) {
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(c)) return original;
  }
  return c;
}

/**
 * Refina a transcrição com Ollama, em lotes (com contexto do lote anterior),
 * usando prompts específicos por idioma. Em caso de falha, retorna os
 * segmentos originais (degradação graciosa).
 */
export async function refineSegments(
  segments: Segment[],
  language: string,
  opts: Partial<RefineOptions> = {},
  onProgress?: (done: number, total: number) => void,
): Promise<{ segments: Segment[]; refinedBatches: number; failedBatches: number }> {
  const options: RefineOptions = {
    model: opts.model ?? DEFAULT_OLLAMA_MODEL,
    host: opts.host ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
    batchSize: opts.batchSize ?? 8,
    timeoutMs: opts.timeoutMs ?? 120_000,
  };
  const client = new Ollama({ host: options.host });

  // Verificação rápida: Ollama acessível e modelo instalado.
  try {
    const list = await withTimeout(client.list(), 5000, () => {});
    const installed = list.models.some((m) => m.name === options.model || m.model === options.model);
    if (!installed) {
      console.warn(`   ⚠️  Modelo "${options.model}" não encontrado no Ollama. Rode: ollama pull ${options.model}`);
      console.warn('   ⚠️  Pulando refinamento — usando transcrição original.');
      return { segments, refinedBatches: 0, failedBatches: 0 };
    }
  } catch {
    console.warn(`   ⚠️  Ollama indisponível em ${options.host}. Pulando refinamento — usando transcrição original.`);
    return { segments, refinedBatches: 0, failedBatches: 0 };
  }

  const system = PROMPTS[language] ?? PROMPTS.default;
  const result: Segment[] = segments.map((s) => ({ ...s }));
  let refinedBatches = 0;
  let failedBatches = 0;

  for (let i = 0; i < result.length; i += options.batchSize) {
    const batch = result.slice(i, i + options.batchSize);
    const context = result.slice(Math.max(0, i - 2), i).map((s) => s.text);

    const userMsg = [
      context.length ? `【Context / 前文 — do not output】\n${context.join('\n')}\n` : '',
      batch.map((s, k) => `${k + 1}. ${s.text}`).join('\n'),
    ].join('\n');

    try {
      const res = await withTimeout(
        client.chat({
          model: options.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
          format: RESPONSE_SCHEMA,
          stream: false,
          options: { temperature: 0.1 },
        }),
        options.timeoutMs,
        () => client.abort(),
      );

      const parsed = JSON.parse(res.message.content) as { lines?: Array<{ n: number; text: string }> };
      const byNumber = new Map<number, string>();
      for (const l of parsed.lines ?? []) if (typeof l?.n === 'number') byNumber.set(l.n, String(l.text ?? ''));

      if (byNumber.size === 0) throw new Error('resposta vazia');
      batch.forEach((s, k) => {
        s.text = acceptCorrection(s.text, byNumber.get(k + 1), language);
      });
      refinedBatches++;
    } catch (err) {
      failedBatches++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`   ⚠️  Lote ${Math.floor(i / options.batchSize) + 1} não refinado (${msg}); mantendo original.`);
    }
    onProgress?.(Math.min(i + options.batchSize, result.length), result.length);
  }

  return { segments: result, refinedBatches, failedBatches };
}
