# Projeto_Legendas
Gera legendas SRT em inglês a partir de vídeos falados em japonês, chinês (ou outros idiomas), 100% local na transcrição e no refino.
# 🎬 Projeto Legendas — Japonês/Chinês → Inglês (EN-US)

Gera legendas **SRT em inglês** a partir de vídeos falados em japonês, chinês (ou outros idiomas), 100% local na transcrição e no refino:

```
Vídeo → FFmpeg (WAV 16 kHz mono + loudnorm) → Whisper large-v3 (whisper.cpp)
      → Ollama qwen2.5:7b (corrige erros de ASR) → DeepL (EN-US, em lotes) → .srt
```

## Requisitos

- **Node.js 18+**
- **FFmpeg** no PATH (`sudo apt install ffmpeg` / `brew install ffmpeg` / `winget install ffmpeg`)
- **cmake + build-essential** (compilação do whisper.cpp pelo `nodejs-whisper`)
  - Ubuntu/Debian: `sudo apt install cmake build-essential`
  - macOS: `xcode-select --install && brew install cmake`
- **Ollama** rodando localmente (https://ollama.com) com o modelo `qwen2.5:7b`
- Chave da **API DeepL** (o plano Free funciona)

## Instalação

```bash
npm install
# Se o npm avisar que o script de instalação do nodejs-whisper não foi executado:
npm rebuild nodejs-whisper   # compila o addon nativo (opcional; senão usa o CLI do whisper.cpp)
cp .env.example .env          # e preencha DEEPL_API_KEY (já preenchido neste projeto)
```

## Primeiro uso

```bash
ollama pull qwen2.5:7b      # recomendado (~4,7 GB)
ollama pull qwen2.5:14b     # opcional: melhor qualidade, exige ~10 GB de RAM/VRAM
```

> O modelo Whisper **large-v3 (~3 GB)** é baixado automaticamente na primeira execução.

## Uso

```bash
npx ts-node src/index.ts video.mp4 --language ja
npx ts-node src/index.ts video.mp4 --language zh --output legendas/video.srt
npx ts-node src/index.ts video.mp4                      # detecção automática do idioma
npx ts-node src/index.ts video.mp4 -l ja --skip-refine  # sem Ollama
npx ts-node src/index.ts video.mp4 -l ja --ollama-model qwen2.5:14b
```

| Opção | Descrição |
|---|---|
| `--language`, `-l` | `ja`, `zh` ou `auto` (padrão) |
| `--skip-refine` | Pula a correção com Ollama |
| `--output`, `-o` | Caminho do SRT (padrão: `<video>.en.srt`) |
| `--ollama-model` | Modelo Ollama (padrão `qwen2.5:14b`) |
| `--whisper-model` | Modelo Whisper (padrão `large-v3`; mais rápido: `large-v3-turbo`) |
| `--keep-audio` | Mantém o WAV temporário |

## Por que funciona melhor para idiomas asiáticos

- **Áudio otimizado**: 16 kHz mono (taxa nativa do Whisper), passa-alta de 80 Hz e normalização de volume reduzem alucinações.
- **Whisper large-v3**: o modelo aberto com menor taxa de erro em japonês e chinês; idioma forçado com `--language` evita detecção errada.
- **Sem divisão por espaços**: CJK não separa palavras com espaço — a quebra de linha usa contagem de caracteres e pontuação (、。，！？).
- **Qwen2.5 (Alibaba)**: treinado fortemente em chinês e japonês; corrige kanji/hanzi homófonos e partículas com prompts escritos no próprio idioma, em lotes de 8 com contexto do lote anterior. Se o Ollama falhar, a transcrição original é mantida.
- **DeepL em lotes de 30** com texto vizinho no parâmetro `context`, recuperando sujeitos omitidos (muito comuns em japonês/chinês).
- **SRT legível**: máx. 42 caracteres × 2 linhas, duração mínima de 1 s.

## Estrutura

```
src/index.ts       CLI e orquestração
src/audio.ts       Extração de áudio (FFmpeg)
src/transcribe.ts  Transcrição (nodejs-whisper / whisper.cpp)
src/refine.ts      Refino com Ollama
src/translate.ts   Tradução DeepL
src/srt.ts         Geração do SRT
```

> 🔒 O arquivo `.env` contém sua chave e está no `.gitignore` — não o compartilhe.
