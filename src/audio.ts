import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Extrai o áudio do vídeo em WAV 16 kHz mono PCM 16-bit (formato nativo do Whisper),
 * com filtro passa-alta (remove ruído grave) e normalização de loudness (EBU R128).
 * Retorna o caminho do WAV em um diretório temporário exclusivo.
 */
export async function extractAudio(videoPath: string): Promise<string> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Arquivo não encontrado: ${videoPath}`);
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'legendas-'));
  const baseName = path.basename(videoPath, path.extname(videoPath)).replace(/[^\w.-]+/g, '_') || 'audio';
  const wavPath = path.join(tmpDir, `${baseName}.wav`);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .audioFilters('highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11')
      .format('wav')
      .on('error', (err: Error) => reject(new Error(`Falha no FFmpeg ao extrair áudio: ${err.message}`)))
      .on('end', () => resolve())
      .save(wavPath);
  });

  const stat = await fs.promises.stat(wavPath);
  if (stat.size <= 44) {
    throw new Error('O vídeo não contém trilha de áudio utilizável.');
  }
  return wavPath;
}

/** Remove o diretório temporário criado por extractAudio (ignora erros). */
export async function cleanupAudio(wavPath: string): Promise<void> {
  try {
    await fs.promises.rm(path.dirname(wavPath), { recursive: true, force: true });
  } catch {
    /* ignorado */
  }
}
