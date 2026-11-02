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
pnpm install
# Se o pnpm avisar que o script de instalação do nodejs-whisper não foi executado:
pnpm rebuild nodejs-whisper   # compila o addon nativo (opcional; senão usa o CLI do whisper.cpp)
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
# Japonês → inglês
pnpm ts-node src/index.ts "video.mp4" --language ja --whisper-model large-v3

# Chinês → inglês, com caminho de saída definido
pnpm ts-node src/index.ts "video.mp4" --language zh --whisper-model large-v3 --output "legendas/video.srt"

# Detecção automática do idioma
pnpm ts-node src/index.ts "video.mp4" --whisper-model large-v3

# Sem refinamento com Ollama
pnpm ts-node src/index.ts "video.mp4" --language ja --whisper-model large-v3 --skip-refine

# Escolhendo outro modelo do Ollama já instalado
pnpm ts-node src/index.ts "video.mp4" --language ja --whisper-model large-v3 --ollama-model qwen2.5:14b
```

> Execute os comandos na pasta do projeto. Informe o nome do modelo Whisper, como large-v3, na opção --whisper-model, e não o caminho de um arquivo .bin. Nos exemplos, essa opção é explícita para evitar que uma configuração incorreta de WHISPER_MODEL seja utilizada. A transcrição e o refinamento são locais; a tradução utiliza a API DeepL.

| Opção | Descrição |
|---|---|
| `--language`, `-l` | `ja`, `zh` ou `auto` (padrão) |
| `--skip-refine` | Pula a correção com Ollama |
| `--output`, `-o` | Caminho do SRT (padrão: `<video>.en.srt`) |
| `--ollama-model` | Modelo Ollama (padrão `qwen2.5:14b`) |
| `--whisper-model` | Nome do modelo Whisper. Modelo usado no teste bem-sucedido: large-v3. Não aceita o caminho do arquivo .bin nessa configuração. |
| `--keep-audio` | Mantém o WAV temporário |

## Por que funciona melhor para idiomas asiáticos

- **Áudio otimizado**: 16 kHz mono (taxa nativa do Whisper), passa-alta de 80 Hz e normalização de volume reduzem alucinações.
- **Whisper large-v3**: o modelo aberto com menor taxa de erro em japonês e chinês; idioma forçado com `--language` evita detecção errada.
- **Sem divisão por espaços**: CJK não separa palavras com espaço — a quebra de linha usa contagem de caracteres e pontuação (、。，！？).
- **Qwen2.5 (Alibaba)**: treinado fortemente em chinês e japonês; corrige kanji/hanzi homófonos e partículas com prompts escritos no próprio idioma, em lotes de 8 com contexto do lote anterior. Se o Ollama falhar, a transcrição original é mantida.
- **DeepL em lotes de 30** com texto vizinho no parâmetro `context`, recuperando sujeitos omitidos (muito comuns em japonês/chinês).
- **SRT legível**: até duas linhas por legenda, com quebra de texto e divisão proporcional do tempo para textos longos. Sobreposições são cortadas no início da próxima legenda, sem impor duração mínima de exibição.

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
