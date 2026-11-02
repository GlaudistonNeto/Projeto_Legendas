import fs from 'fs';
import type { Segment } from './types';

const MAX_CHARS_PER_LINE = 42;
const MAX_LINES = 2;

export function formatTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/;

/** Texto com predominância CJK (sem espaços entre palavras). */
function isCjk(text: string): boolean {
  const chars = [...text.replace(/\s/g, '')];
  if (!chars.length) return false;
  return chars.filter((c) => CJK_RE.test(c)).length / chars.length > 0.3;
}

/** Quebra por palavras (idiomas com espaço). */
function wrapWords(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= max) cur += ' ' + word;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Quebra por caracteres (CJK), preferindo cortar após pontuação. CJK ocupa 2 colunas. */
function wrapCjk(text: string, max: number): string[] {
  const width = (c: string) => (CJK_RE.test(c) ? 2 : 1);
  const breakAfter = /[、。，,！!？?；;：:…・」』）)\s]/;
  const chars = [...text];
  const lines: string[] = [];
  let cur: string[] = [];
  let curW = 0;
  let lastBreak = -1;
  for (const c of chars) {
    cur.push(c);
    curW += width(c);
    if (breakAfter.test(c)) lastBreak = cur.length;
    if (curW > max) {
      const cut = lastBreak > 0 && lastBreak < cur.length ? lastBreak : cur.length - 1;
      lines.push(cur.slice(0, cut).join('').trim());
      cur = cur.slice(cut);
      curW = cur.reduce((a, ch) => a + width(ch), 0);
      lastBreak = -1;
    }
  }
  if (cur.length) lines.push(cur.join('').trim());
  return lines.filter(Boolean);
}

export function wrapText(text: string, max = MAX_CHARS_PER_LINE): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  return isCjk(clean) ? wrapCjk(clean, max) : wrapWords(clean, max);
}

/** Equilibra duas linhas (evita uma linha longa e outra com uma palavra). */
function balanceTwoLines(text: string, max: number): string[] | null {
  if (isCjk(text)) return null;
  const words = text.split(' ');
  let best: string[] | null = null;
  let bestDiff = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' ');
    const b = words.slice(k).join(' ');
    if (a.length <= max && b.length <= max && Math.abs(a.length - b.length) < bestDiff) {
      best = [a, b];
      bestDiff = Math.abs(a.length - b.length);
    }
  }
  return best;
}

interface Cue {
  start: number;
  end: number;
  lines: string[];
}

/**
 * Converte segmentos em cues SRT: até 2 linhas de 42 caracteres. Textos
 * maiores são divididos em vários cues, com o tempo repartido proporcionalmente.
 */
function buildCues(segments: Segment[]): Cue[] {
  const cues: Cue[] = [];
  for (const seg of segments) {
    const text = (seg.translation ?? seg.text).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const lines = wrapText(text);
    if (lines.length === 2) {
      const balanced = balanceTwoLines(text, MAX_CHARS_PER_LINE);
      if (balanced) lines.splice(0, 2, ...balanced);
    }
    const chunks: string[][] = [];
    for (let i = 0; i < lines.length; i += MAX_LINES) chunks.push(lines.slice(i, i + MAX_LINES));

    const totalChars = chunks.reduce((a, c) => a + c.join('').length, 0) || 1;
    const duration = Math.max(seg.end - seg.start, 0);
    let t = seg.start;
    for (const chunk of chunks) {
      const d = duration * (chunk.join('').length / totalChars);
      cues.push({ start: t, end: t + d, lines: chunk });
      t += d;
    }
  }

  // Duração mínima de 1s sem sobrepor a próxima legenda.
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const next = cues[i + 1];
    if (next && c.end > next.start) {
      c.end = next.start;
    }
  }

  return cues.filter((c) =>
    Number.isFinite(c.start) &&
    Number.isFinite(c.end) &&
    Math.round(c.end * 1000) > Math.round(c.start * 1000)
  );
}

export function buildSrt(segments: Segment[]): string {
  return (
    buildCues(segments)
      .map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.lines.join('\n')}\n`)
      .join('\n')
  );
}

export async function writeSrt(segments: Segment[], outputPath: string): Promise<number> {
  const content = buildSrt(segments);
  await fs.promises.writeFile(outputPath, content, 'utf8');
  return content ? content.split(/\n\n/).filter(Boolean).length : 0;
}
