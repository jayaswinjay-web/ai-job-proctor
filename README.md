# VoiceHire â€” AI Job Screening & Proctoring Platform

A voice-first job screening and proctoring platform. A candidate sits at a kiosk and has a
spoken job interview; a recruiter reviews transcripts, scores, AI evaluation, proctoring
events and reports in an admin console.

## Architecture

```
apps/api          HTTP + WebSocket backend (Fastify, Prisma, PostgreSQL)
apps/kiosk        Kiosk thin client (browser) â€” React/Vite
apps/admin        Recruiter admin console â€” React/Vite
packages/ai       Provider registry: LLM / STT / TTS / evaluation (real + deterministic mocks)
packages/speech   Browser speech: recogniser, synthesiser, VAD, recorder
packages/types    Shared Zod schemas + DTOs + voice phrase tables
packages/database Prisma client, schema, migrations
packages/config   Validated environment contract
packages/ui       Shared design tokens
apps/voice-agent  Cloud AI voice agent (LiveKit) â€” deployed remotely, never on the kiosk
```

### Interview flow

```
Kiosk (browser) â”€â”€WebSocket/HTTPâ”€â”€â–¶ Backend interview engine â—€â”€â”€ questions, jobs, scoring, DB
      â–²                                    â”‚
      â””â”€â”€ speech in/out â”€â”€â–¶ STT / TTS â—€â”€â”€â”€â”€â”˜
```

By default the kiosk transcribes and speaks in the browser (no keys). For the
**LiveKit Cloud** thin-client voice-first architecture â€” where all AI runs in the cloud and
the kiosk is only a mic + speaker â€” see **[docs/voice-architecture.md](docs/voice-architecture.md)**.

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

- **Database** â€” `DATABASE_URL`
- **Auth** â€” `AUTH_SECRET` (32+ chars), token TTLs, lockout, TOTP
- **Demo mode** â€” `DEMO_MODE=true` uses local mocks for every AI provider
- **AI providers** â€” `LLM_PROVIDER`, `STT_PROVIDER`, `TTS_PROVIDER`, `AI_API_KEY`
- **Voice (browser)** â€” `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE`, voice tuning
- **LiveKit Cloud voice (thin client)** â€” `VOICE_MODE`, `LIVEKIT_*`, `VOICE_AGENT_NAME`,
  `AGENT_API_KEY` (see the voice-architecture doc)
- **Privacy / retention** â€” recording, transcript and candidate retention windows

### Fully offline operation (no internet)

The recommended offline setup on this machine is (this is the shipped .env):

```env
DEMO_MODE=false
EVALUATION_PROVIDER=rules       # deterministic rubric, no LLM call
LLM_PROVIDER=mock               # deterministic, local; withFallback(…, mockLlm) everywhere
STT_PROVIDER=whisper-http       # server-side fallback -> local faster-whisper (port 8095)
AI_BASE_URL=http://127.0.0.1:8095/v1/audio/transcriptions
TTS_PROVIDER=browser            # voice path uses Piper via the local agent
VOICE_MODE=livekit
LIVEKIT_URL=ws://localhost:7880  # local LiveKit Server (docker)
ALLOW_BROWSER_VOICE_FALLBACK=false
```

How each layer stays offline:

- Kiosk (thin WebRTC client) -> `ws://localhost:7880` local LiveKit Server (docker).
- LiveKit dispatches the local Python agent (`scripts/local-livekit-agent.py`) which
  streams the candidate mic through Silero VAD -> faster-whisper (CUDA) -> llama.cpp
  (Tamil LLaMA, CUDA) -> Piper Tamil TTS (port 8095). No frame leaves the machine.
- Interview scoring is the rules provider; conversational/report LLM calls are
  deterministic (`LLM_PROVIDER=mock`) and are the designated `withFallback` targets, so
  nothing reaches a cloud gateway even if an upstream provider were misconfigured.
- Server-side STT fallback (`/kiosk/sessions/:id/transcribe`) uploads audio to the same
  local faster-whisper server via the OpenAI-compatible endpoint it now exposes
  (`POST /v1/audio/transcriptions`); the browser never needs the network for speech.
- Admin/kiosk/API communicate over loopback only; both Vite dev servers bind `0.0.0.0`
  for LAN convenience - that changes nothing about outbound traffic.
- Face presence is OpenCV Haar cascades on the local webcam (port 8090).

Steps:
1. `cp .env.example .env` (already contains the offline settings)
2. `npm run db:up`
3. Double-click `AI Job Proctor.lnk` - services boot
4. Open `http://localhost:5173/` (kiosk) or `http://<LAN-IP>:5173/` from any browser on the same network
5. No outbound traffic at runtime; internet can be switched off.

### What to expect when you try it (voice)

The kiosk shows a high-visibility panel at all times:

| During these moments | Panel says |
|---|---|
| Agent is greeting / asking a question | AI is speaking (wait) |
| Agent is waiting for your answer | Speak now |
| Connecting / reconnecting | Connecting |

The intro video launches automatically; tap anywhere to skip it. The kiosk never stays on the video for longer than 12 seconds.

> Pitch readiness rule: the face gate arms, the mic is hot the moment the interview screen shows. There is no waiting period between screens.

The local voice agent (`scripts/local-livekit-agent.py`) conducts the interview itself:
it greets the candidate, asks job and language by voice (scripted Tamil-first copy),
takes consent, and then works through the backend-driven question plan (BASIC_DETAILS
-> job questions -> completion) — the same directives the cloud agent used to read.

Notes on quality:

- The interviewer runs entirely locally; there is no LLM "chat" in the voice path —
  the script and the rules engine drive every line.
- Turn handling is VAD-based and interruptions are off: candidate audio spoken *while
  the agent is speaking* is discarded. Stand at the camera, wait for it to finish its
  line, then answer — same as the intended kiosk behaviour.
- Local Tamil ASR is the weakest link on current hardware: Whisper tiny/small can
  mis-hear both the synthetic Piper voice and quiet real speech. If the agent does not
  seem to be hearing you, speak clearly and wait for the greeting to finish; the
  scripted flow re-reads the options when an answer is unrecognized.
- `F:\models\faster-whisper-small` is used instead of tiny when `WHISPER_MODEL` is set
  (see `.env`). The `large-v3-turbo` upgrade was blocked by the model CDN being
  unreachable from this network; if your network can reach it, that is the quality
  upgrade path.

To point **other machines** on your LAN at the kiosk/admin: both dev servers are now
bound to `0.0.0.0`, so:

- Kiosk:   `http://<LAN-IP>:5173/`  (the candidate interview)
- Admin:   `http://<LAN-IP>:5174/`
- API:     `http://<LAN-IP>:4000/api/v1/...`

LAN IP on Windows: `ipconfig` â†’ look for `IPv4 Address`. On this machine it is
`172.16.147.5` (Wi-Fi); WSL vEthernet shows a different address that is not reachable
from other devices.

Secrets are read server-side only and are never bundled into the browser.

## Ethical and legal note

AI scoring here is **AI-assisted**, not authoritative: reports carry a human-review
disclaimer, low-confidence sessions are routed to human review, and proctoring events never
affect a candidate's score or recommendation. Confirm local labour, recording and data
protection law with counsel before production use.
