# VoiceHire — AI Job Screening & Proctoring Platform

A voice-first job screening and proctoring platform. A candidate sits at a kiosk and has a
spoken job interview; a recruiter reviews transcripts, scores, AI evaluation, proctoring
events and reports in an admin console.

## Architecture

```
apps/api          HTTP + WebSocket backend (Fastify, Prisma, PostgreSQL)
apps/kiosk        Kiosk thin client (browser) — React/Vite
apps/admin        Recruiter admin console — React/Vite
packages/ai       Provider registry: LLM / STT / TTS / evaluation (real + deterministic mocks)
packages/speech   Browser speech: recogniser, synthesiser, VAD, recorder
packages/types    Shared Zod schemas + DTOs + voice phrase tables
packages/database Prisma client, schema, migrations
packages/config   Validated environment contract
packages/ui       Shared design tokens
apps/voice-agent  Cloud AI voice agent (LiveKit) — deployed remotely, never on the kiosk
```

### Interview flow

```
Kiosk (browser) ──WebSocket/HTTP──▶ Backend interview engine ◀── questions, jobs, scoring, DB
      ▲                                    │
      └── speech in/out ──▶ STT / TTS ◀────┘
```

By default the kiosk transcribes and speaks in the browser (no keys). For the
**LiveKit Cloud** thin-client voice-first architecture — where all AI runs in the cloud and
the kiosk is only a mic + speaker — see **[docs/voice-architecture.md](docs/voice-architecture.md)**.

## Quick start

Prerequisites: Node 20+, Docker (for PostgreSQL).

```bash
npm install
cp .env.example .env            # then edit AUTH_SECRET and DATABASE_URL if needed

npm run db:up                   # start PostgreSQL
npm run bootstrap               # generate client, apply migrations, seed admin + sample data

npm run dev:api                 # backend  :4000
npm run dev:kiosk               # kiosk    :5173
npm run dev:admin               # admin    :5174
```

The seeded admin credentials are printed once by `npm run bootstrap`
(`BOOTSTRAP_ADMIN_EMAIL` in `.env`). Demo mode (`DEMO_MODE=true`) makes every AI provider a
local deterministic mock, so the whole app runs with zero external calls and no API keys.

## Verifying

```bash
npm run typecheck    # all workspaces
npm test             # API unit tests
npm run smoke        # browser smoke for the kiosk and admin apps
node scripts/acceptance.mjs    # full end-to-end acceptance against a running API
```

## Configuration

All configuration lives in `.env` (see `.env.example`, validated on boot by
`packages/config`). The important groups:

- **Database** — `DATABASE_URL`
- **Auth** — `AUTH_SECRET` (32+ chars), token TTLs, lockout, TOTP
- **Demo mode** — `DEMO_MODE=true` uses local mocks for every AI provider
- **AI providers** — `LLM_PROVIDER`, `STT_PROVIDER`, `TTS_PROVIDER`, `AI_API_KEY`
- **Voice (browser)** — `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE`, voice tuning
- **LiveKit Cloud voice (thin client)** — `VOICE_MODE`, `LIVEKIT_*`, `VOICE_AGENT_NAME`,
  `AGENT_API_KEY` (see the voice-architecture doc)
- **Privacy / retention** — recording, transcript and candidate retention windows

Secrets are read server-side only and are never bundled into the browser.

## Ethical and legal note

AI scoring here is **AI-assisted**, not authoritative: reports carry a human-review
disclaimer, low-confidence sessions are routed to human review, and proctoring events never
affect a candidate's score or recommendation. Confirm local labour, recording and data
protection law with counsel before production use.