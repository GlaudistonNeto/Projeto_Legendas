import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { extractAudio, cleanupAudio } from './audio';
import { transcribe } from './transcribe';
import { refineSegments, DEFAULT_OLLAMA_MODEL } from './refine';
import { translateSegments } from './translate';
import { writeSrt } from './srt';
import type { CliOptions } from './types';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config();

const LANGUAGE_LABELS: Record<string, string> = {
  ja: 'japonês',
  zh: 'chinês',
  yue: 'cantonês',
  ko: 'coreano',
  en: 'inglês',
  pt: 'português',
};

function printUsage(): void {
  console.log(`
Uso: npx ts-node src/index.ts <arquivo-de-video> [opções]

Opções:
  --language, -l <ja|zh|auto>  Idioma falado no vídeo (padrão: auto)
  --skip-refine                Pula a correção da transcrição com Ollama
  --output, -o <arquivo.srt>   Caminho do SRT de saída (padrão: <video>.en.srt)
  --ollama-model <nome>        Modelo Ollama (padrão: ${DEFAULT_OLLAMA_MODEL})
  --whisper-model <nome>       Modelo Whisper (padrão: large-v3)
  --keep-audio                 Mantém o WAV temporário extraído
  --help, -h                   Mostra esta ajuda

Exemplo:
  npx ts-node src/index.ts video.mp4 --language ja
`);
}

function parseArgs(argv: string[]): CliOptions | null {
  const opts: Partial<CliOptions> = {
    language: 'auto',
    skipRefine: false,
    ollamaModel: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    whisperModel: process.env.WHISPER_MODEL || 'large-v3',
    keepAudio: false,
  };
  const need = (i: number, flag: string): string => {
    const v = argv[i];
    if (!v || v.startsWith('--')) throw new Error(`A opção ${flag} exige um valor.`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        return null;
      case '--language':
      case '-l':
        opts.language = need(++i, a).toLowerCase();
        break;
      case '--skip-refine':
        opts.skipRefine = true;
        break;
      case '--output':
      case '-o':
        opts.output = need(++i, a);
        break;
      case '--ollama-model':
        opts.ollamaModel = need(++i, a);
        break;
      case '--whisper-model':
        opts.whisperModel = need(++i, a);
        break;
      case '--keep-audio':
        opts.keepAudio = true;
        break;
      default:
        if (a.startsWith('-')) throw new Error(`Opção desconhecida: ${a}`);
        if (opts.input) throw new Error(`Mais de um arquivo de entrada informado: ${a}`);
        opts.input = a;
    }
  }

  if (!opts.input) return null;
  if (opts.language !== 'auto' && !/^[a-z]{2,3}$/.test(opts.language!)) {
    throw new Error(`Idioma inválido: "${opts.language}". Use ja, zh ou auto.`);
  }
  const input = path.resolve(opts.input);
  const output = opts.output
    ? path.resolve(opts.output)
    : path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.en.srt`);
  return { ...(opts as CliOptions), input, output };
}

function elapsed(startMs: number): string {
  const s = (Date.now() - startMs) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}min ${Math.round(s % 60)}s`;
}

function progress(label: string) {
  return (done: number, total: number) => {
    process.stdout.write(`\r   ${label}: ${done}/${total}   `);
    if (done >= total) process.stdout.write('\n');
  };
}

async function main(): Promise<void> {
  let opts: CliOptions | null;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    printUsage();
    process.exit(1);
  }
  if (!opts) {
    printUsage();
    process.exit(process.argv.length > 2 ? 0 : 1);
  }

  if (!fs.existsSync(opts.input)) {
    console.error(`❌ Arquivo de vídeo não encontrado: ${opts.input}`);
    process.exit(1);
  }
  if (!process.env.DEEPL_API_KEY) {
    console.error('❌ DEEPL_API_KEY não encontrada. Copie .env.example para .env e preencha a chave.');
    process.exit(1);
  }

  const t0 = Date.now();
  let wavPath: string | null = null;

  try {
    // 1) FFmpeg
    console.log(`📢 Extraindo áudio de "${path.basename(opts.input)}" (16 kHz mono, normalizado)...`);
    let t = Date.now();
    wavPath = await extractAudio(opts.input);
    console.log(`   Áudio extraído em ${elapsed(t)}`);

    // 2) Whisper
    console.log(`🎙️  Transcrevendo com Whisper (${opts.whisperModel})... isso pode levar alguns minutos.`);
    console.log('   (Na primeira execução o modelo é baixado automaticamente — large-v3 tem ~3 GB.)');
    t = Date.now();
    const transcription = await transcribe(wavPath, opts.language, opts.whisperModel);
    const lang = transcription.language;
    console.log(`   Idioma: ${LANGUAGE_LABELS[lang] ?? lang} (${lang})${opts.language === 'auto' ? ' — detectado automaticamente' : ''}`);
    console.log(`   ${transcription.segments.length} segmentos transcritos em ${elapsed(t)}`);

    if (transcription.segments.length === 0) {
      throw new Error('Nenhuma fala foi detectada no áudio.');
    }

    // 3) Ollama
    let segments = transcription.segments;
    if (opts.skipRefine) {
      console.log('✨ Refinamento com Ollama pulado (--skip-refine).');
    } else {
      console.log(`✨ Refinando transcrição com Ollama (${opts.ollamaModel})...`);
      t = Date.now();
      const refined = await refineSegments(segments, lang, { model: opts.ollamaModel }, progress('Segmentos'));
      segments = refined.segments;
      if (refined.refinedBatches > 0) {
        console.log(`   ${refined.refinedBatches} lote(s) refinado(s), ${refined.failedBatches} com falha, em ${elapsed(t)}`);
      }
    }

    // 4) DeepL
    console.log('🌐 Traduzindo para inglês (EN-US) com DeepL...');
    t = Date.now();
    segments = await translateSegments(segments, lang, progress('Segmentos'));
    console.log(`   Tradução concluída em ${elapsed(t)}`);

    // 5) SRT
    await fs.promises.mkdir(path.dirname(opts.output), { recursive: true });
    const cues = await writeSrt(segments, opts.output);
    console.log(`✅ Legenda gerada com sucesso! (${cues} legendas, tempo total ${elapsed(t0)})`);
    console.log(`   Arquivo: ${opts.output}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Erro: ${msg}`);
    if (/ffmpeg/i.test(msg) && /ENOENT|not found|Cannot find/i.test(msg)) {
      console.error('   Verifique se o FFmpeg está instalado e no PATH.');
    }
    if (/cmake|make|whisper-cli|build/i.test(msg)) {
      console.error('   Falha ao compilar/executar o whisper.cpp. Instale cmake e build-essential (veja o README).');
    }
    process.exitCode = 1;
  } finally {
    if (wavPath) {
      if (opts.keepAudio) console.log(`   Áudio temporário mantido em: ${wavPath}`);
      else await cleanupAudio(wavPath);
    }
  }
}

main();
