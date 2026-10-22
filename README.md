# Interview Copilot

Local, single-user web app that listens to an interview tab (HR) and your mic, transcribes both
with Deepgram Nova-3, and streams CV-grounded answer hints from Claude Haiku 5.5.
Spec: `PRD — Interview Copilot` (pdf/docx in this folder).

Status: **M0 (POC)** — capture → STT → question detection → streaming answers + latency log.

## Run (dev, no Docker)

Requirements: Node ≥ 20.11, MySQL 8 on 127.0.0.1:3306 (Laragon), Chrome or Edge desktop.

```bash
cp .env.example .env            # then fill ANTHROPIC_API_KEY and DEEPGRAM_API_KEY
npm install
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS interview_copilot CHARACTER SET utf8mb4"
npm run db:migrate              # creates the 7 tables
npm run dev                     # api on 127.0.0.1:3001, web on http://localhost:5173
```

Docker (`docker compose up --build`) is prepared but not yet the main dev path.

## Layout

- `packages/shared` — WebSocket event types (zod), audio constants, pricing, latency helpers
- `apps/api` — NestJS + Prisma; REST under `/api`, live session WebSocket at `/ws/session/:id`
- `apps/web` — Vite + React; audio worklet (`public/pcm-worklet.js`), Silero VAD, live UI

## POC gate check

Run a session with ~20 test questions, then:

```
GET http://127.0.0.1:3001/api/sessions/<id>/latency
```

returns p50/p90 first-word latency (HR end of speech → first token painted). Per-answer stage
timings and token/cache usage are also logged by the API (`latency … cache_read=…`).

Knobs in `.env`: `LIVE_THINKING` (disabled|adaptive), `LIVE_EFFORT`, `DG_ENDPOINTING_MS`,
`DG_UTTERANCE_END_MS`.
