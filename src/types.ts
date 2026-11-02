/** Um segmento de fala com tempos em segundos. */
export interface Segment {
  id: number;
  start: number;
  end: number;
  /** Texto no idioma original (após transcrição/refino). */
  text: string;
  /** Texto traduzido (EN-US), preenchido pela etapa de tradução. */
  translation?: string;
}

export interface TranscriptionResult {
  /** Código ISO 639-1 (ex.: "ja", "zh"). */
  language: string;
  segments: Segment[];
}

/** Formato JSON gerado pelo whisper.cpp / nodejs-whisper (outputInJson). */
export interface WhisperJsonOutput {
  transcription: Array<{
    timestamps?: { from: string; to: string };
    offsets: { from: number; to: number };
    text: string;
  }>;
  result?: { language?: string };
}

export interface CliOptions {
  input: string;
  /** "ja", "zh", "ko", ... ou "auto". */
  language: string;
  skipRefine: boolean;
  output: string;
  ollamaModel: string;
  whisperModel: string;
  keepAudio: boolean;
}

export interface RefineOptions {
  model: string;
  host: string;
  batchSize: number;
  timeoutMs: number;
}
