export async function writeSrt(segments: Segment[], outputPath: string): Promise<number> {
  const content = buildSrt(segments);
  await fs.promises.writeFile(outputPath, content, 'utf8');
  return content ? content.split(/\n\n/).filter(Boolean).length : 0;
}
