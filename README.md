# Lexa

Lexa is a small research tool I built as part of my Master's thesis in Digital Linguistics at the University of Zurich (UZH), supervised by Dr. Sina Ahmadi.

The main idea behind it is quite simple: working with multilingual speech data gets messy quite quickly, especially when the same transcript contains loanwords, code-switching and uncertain cases. I wanted one place where I could go from an audio recording to a corrected transcript and then annotate these different phenomena directly in the text.

Lexa therefore combines transcription, correction and linguistic annotation in one workflow. It is mainly intended for multilingual and low-resource language data.

## What you can do with Lexa

With Lexa, a researcher or annotator can:

- upload an audio or video recording;
- generate an automatic transcription with word-level timestamps;
- listen back to the recording and correct the transcript manually;
- adjust segment boundaries and timings;
- mark words or passages as **loanwords**, **code-switches** or **unclear**;
- add information such as source language, pronunciation, confidence and notes;
- keep track of speakers and recording metadata;
- review annotations and compare annotations between users;
- export the resulting corpus in different formats, including JSON, CSV, XLSX, WebVTT, SubRip, ELAN `.eaf` and Praat `.TextGrid`.

One thing that was important to me while building the tool was not to silently "clean up" the linguistic data. If a transcript is corrected, existing timings and annotations should stay attached to the right words whenever possible. If Lexa cannot do that confidently, the item is flagged for review instead of simply being deleted.

## Why I built it

My thesis looks at loanwords and code-switching in multilingual and minority-language settings, and at how language technologies such as automatic speech recognition deal with this kind of mixed data.

Lexa started as a practical way to make that process easier. Instead of using separate tools for transcription, correction, annotation and export, I wanted a workflow where all of these steps stay connected.

The current research setup also records information about the languages in the dataset, including their EGIDS level, so that language vitality and endangerment can later be considered alongside the annotation results. EGIDS is treated as information about each language rather than as a fixed quota for data collection.

## Data and privacy

This repository contains the **software only**. It does not contain participant recordings, participant information, research transcripts or annotation datasets from the thesis.

The intended use for collaborators is to run Lexa locally on their own material. This means that their source recordings do not need to be uploaded to a public Lexa server.

Please do not commit any of the following to a public repository:

- `.env` or `.env.local` files;
- API keys or passwords;
- database credentials;
- participant names or contact details;
- audio/video recordings from participants;
- confidential transcripts or annotation data.

## Tech stack

Lexa is built with Next.js, React and TypeScript. PostgreSQL is used for the database, Redis/BullMQ for background jobs, and Whisper can be used for automatic transcription. ffmpeg is used for audio processing.

Main components:

- Next.js 15
- React 19
- TypeScript
- Prisma + PostgreSQL
- BullMQ + Redis
- Auth.js
- Zustand
- TanStack Query
- ffmpeg
- Whisper

## Running Lexa locally

### Requirements

You will need:

- Node.js 20 or newer;
- pnpm;
- Docker, or equivalent PostgreSQL and Redis services;
- a Whisper server for local transcription.

An NVIDIA GPU is useful for larger Whisper models such as `large-v3`, but smaller models can also be used on CPU.

### 1. Start PostgreSQL and Redis

Example using Docker:

```bash
docker run -d --name lexa-postgres --restart always \
  -e POSTGRES_USER=lexa -e POSTGRES_PASSWORD=YOUR_DB_PASSWORD -e POSTGRES_DB=lexa \
  -p 5433:5432 -v lexa-pg:/var/lib/postgresql/data postgres:17

docker run -d --name lexa-redis --restart always \
  -p 6379:6379 -v lexa-redis:/data redis:7-alpine
```

### 2. Start Whisper

For example:

```bash
docker run -d --name lexa-whisper --restart always --gpus all \
  -p 9000:9000 -v whisper-data:/var/lib/whisper \
  -e WHISPER_MODEL=large-v3 -e WHISPER_DEVICE=auto \
  hwdsl2/whisper-server:cuda
```

On Windows, the repository also contains a helper script:

```powershell
$env:WHISPER_MODEL = "large-v3"
scripts\start-whisper.ps1
```

### 3. Set up the app

Install the dependencies:

```bash
pnpm install
```

Copy the example environment file:

```bash
cp .env.example .env.local
```

Then fill in the required values in `.env.local`.

Create the database schema and initial admin account:

```bash
pnpm db:push
pnpm seed
```

For development, start the app with:

```bash
pnpm dev
```

In a second terminal, start the transcription worker:

```bash
pnpm worker
```

Lexa should then be available at:

```text
http://localhost:3000
```

The worker needs to stay running for transcription jobs to be processed.

## Configuration

The main settings are documented in `.env.example`.

| Variable              | What it is for                      |
| ---                   | ---                                 |
| `DATABASE_URL`        | PostgreSQL connection               |
| `AUTH_SECRET`         | authentication secret               |
| `AUTH_URL`            | local app URL                       |
| `REDIS_URL`           | Redis connection                    |
| `STORAGE_BACKEND`     | local, hybrid or Supabase storage   |
| `LOCAL_MEDIA_PATH`    | local folder used for recordings    |
| `WHISPER_SERVER_URL`  | address of the Whisper server       |
| `WHISPER_MODEL`       | Whisper model to use                |
| `WHISPER_API_KEY`     | API key for the Whisper server      |
| `SEED_ADMIN_EMAIL`    | email for the first admin user      |
| `SEED_ADMIN_PASSWORD` | password for the first admin user   |

Google Cloud Speech-to-Text can also be configured as an alternative transcription backend. The relevant variables are described in `.env.example`.

## A little bit about the annotation workflow

A recording first goes through audio processing and automatic transcription. The resulting words are stored with timestamps and confidence information. After that, the transcript can be corrected manually and annotated.

The main annotation categories are:

- **Loanword** – a borrowed lexical item used within the surrounding language;
- **Code-switch** – a switch into another language;
- **Unclear** – a case where the annotator cannot confidently decide or the speech itself is unclear.

The exact distinction between a loanword and a code-switch is part of the research question, so the tool deliberately keeps the annotation flexible instead of trying to decide this automatically.

## Keeping edits traceable

Some of the less visible parts of the project are there to make sure edits do not accidentally damage the corpus.

- `lib/realign.ts` tries to preserve timings and annotations when transcript text is edited.
- `lib/segmenter.ts` handles transcript segmentation.
- `lib/anchor.ts` keeps annotations linked to the relevant words and moves unresolved cases to review.
- `lib/ops.ts` stores workspace changes as revisions, which also supports undo/redo.

The reasoning behind some of these implementation choices is documented in `DECISIONS.md`.

## Project structure

```text
app/            pages and API routes
components/     interface and workspace components
lib/            transcription, annotation, storage and export logic
worker/         background transcription worker
prisma/         database schema and seed script
content/        annotation guidelines
scripts/        setup and maintenance scripts
tests/          unit and end-to-end tests
```

## Useful commands

| Command             | What it does                              |
| ---                 | ---                                       |
| `pnpm dev`          | starts Lexa in development mode           |
| `pnpm build`        | creates a production build                |
| `pnpm start`        | starts the production server              |
| `pnpm worker`       | starts the transcription worker           |
| `pnpm db:push`      | applies the Prisma schema to the database |
| `pnpm seed`         | creates the initial admin account/project | 
| `pnpm typecheck`    | runs the TypeScript type check            |
| `pnpm lint`         | runs ESLint                               |
| `pnpm test`         | runs the unit tests                       |
| `pnpm test:e2e`     | runs the Playwright end-to-end tests      |

## Author

**Emma Cehic**  
Master's student in Digital Linguistics  
University of Zurich

Lexa was developed as part of my Master's thesis under the supervision of **Dr. Sina Ahmadi**.
