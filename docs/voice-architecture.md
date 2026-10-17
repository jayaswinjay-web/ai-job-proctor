# VoiceHire — LiveKit Cloud Voice Architecture

This document describes the voice-first, hands-free interview architecture and how to
configure and deploy it. It complements the existing backend/admin documentation.

## Shape

```
                 ┌─────────────────────────┐
                 │        KIOSK            │   thin client only
                 │  Browser + mic + speaker│
                 └───────────┬─────────────┘
                             │  WebRTC (LiveKit SDK)
                             ▼
                 ┌─────────────────────────┐
                 │      LIVEKIT CLOUD      │   realtime voice transport
                 └───────────┬─────────────┘
                             │  dispatches agent
                             ▼
                 ┌─────────────────────────┐
                 │     CLOUD VOICE AGENT   │   apps/voice-agent (remote)
                 │  STT / LLM / TTS via    │
                 │  LiveKit agent gateway  │
                 └───────────┬─────────────┘
                             │  HTTPS + AGENT_API_KEY
                             ▼
                 ┌─────────────────────────┐
                 │    VOICEHIRE BACKEND    │   jobs, questions, scoring,
                 │      (apps/api)         │   consent, transcripts, reports,
                 └─────────────────────────┘   proctoring, admin dashboard
```

The **kiosk never runs STT, TTS, an LLM, an agent, or a media server.** It only publishes
microphone audio and plays the agent's audio. The heavy, real-time work is all in LiveKit
Cloud and the remote agent.

## AI providers: bundled with LiveKit, no extra accounts

The voice agent uses **LiveKit's own agent gateway** for STT, TTS and the LLM, authenticating
with the same `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` used for room access. There are **no
Deepgram / ElevenLabs / OpenAI / Google keys to obtain** — usage is billed to the LiveKit
project as inference credits. Defaults (all overridable by environment variable):

| Function | Default model | Capability |
|---|---|---|
| STT | `speechmatics/linden-1` (`en_ta`) | Tamil + English code-switching (also `hi`, `mr`) |
| LLM | `google/gemini-2.5-flash` | conversation, intent, follow-ups |
| TTS | `cartesia/sonic-3` | multilingual, Tamil voice |

## Data flow of one turn

```
candidate speaks → kiosk publishes mic → LiveKit Cloud → agent
  → Speechmatics STT (Tamil + English) → Gemini LLM → backend /agent/sessions/:id/turns
  → engine returns next question / follow-up → Cartesia TTS → LiveKit → kiosk speaker
```

The interview **content, scoring and records stay in VoiceHire**. The agent only conducts
the conversation; it calls the backend to read context and submit what was said.

## Kiosk flow (hands-free)

1. Kiosk calls `POST /api/v1/kiosk/voice/intake-token` and joins an ephemeral intake room.
2. The cloud agent greets in **Tamil**, reads out **all** jobs and **all** languages.
3. Candidate chooses job → confirmation → language → confirmation.
4. Speaker test → microphone test → onboarding → consent.
5. Agent calls `POST /agent/sessions` to create the interview session, then pushes the
   `{type:'session', sessionId, sessionSecret}` binding to the kiosk over a LiveKit data
   message so the kiosk can report proctoring events.
6. Questions, follow-ups, evaluation and completion run through the existing engine.

## Configuration (server-side only)

VoiceHire backend (`.env`):

```text
VOICE_MODE=livekit            # production cloud voice agent
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...        # SERVER ONLY — signs short-lived kiosk tokens
LIVEKIT_TOKEN_TTL_MINUTES=15
VOICE_AGENT_NAME=voicehire-interview
AGENT_API_KEY=...             # shared with the agent worker
ALLOW_BROWSER_VOICE_FALLBACK=false
VOICE_DEFAULT_LANGUAGE=ta
```

The browser only ever receives a **short-lived, room-scoped LiveKit token**. The API
secret is never sent to the client.

Voice agent worker (`apps/voice-agent`) needs, in addition:

```text
OPENAI_API_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json   # or GOOGLE_API_KEY
VOICEHIRE_API_URL=https://<api-host>/api/v1
AGENT_API_KEY=<same value as the backend>
```

## Behaviour when not configured (spec §29)

- `VOICE_MODE=livekit` with no LiveKit credentials → the kiosk shows a clear
  **"Voice AI service is not configured"** screen. It does **not** silently fall back.
- In **development only**, the legacy browser speech pipeline remains available
  (`ALLOW_BROWSER_VOICE_FALLBACK`, auto-enabled in non-production with a warning). This is
  a development/testing affordance and must not be used for production interviews.
- The agent callback API is closed unless `AGENT_API_KEY` is set (constant-time compared).

## Deployment

1. Create a **LiveKit Cloud** project → copy URL / API key / secret.
2. Deploy the web app (`apps/api`, `apps/kiosk`, `apps/admin`) with the backend secrets set.
3. Deploy `apps/voice-agent` to a LiveKit-supported cloud host (LiveKit Cloud Agents, Fly,
   Render, …). It dials out to LiveKit Cloud and exposes no public HTTP surface.
4. Register the worker under `VOICE_AGENT_NAME`. Rooms dispatch it automatically because the
   kiosk's token carries `roomConfig.agents`.
5. Create a Google Cloud service account with **Speech-to-Text** and **Text-to-Speech**
   enabled (Tamil `ta-IN`), and an OpenAI key.
6. Test: kiosk starts → Tamil greeting → all jobs → job → all languages → language →
   speaker test → mic test → onboarding → consent → questions → completion → report in the
   admin console.

## Data model additions

`interview_sessions` (migration `20261007120000_livekit_voice_transport`):

| Column | Purpose |
|---|---|
| `voiceTransport` | `livekit` or `browser` |
| `livekitRoomName` | LiveKit Cloud room |
| `livekitSessionId` | LiveKit room SID |
| `voiceAgentSessionId` | dispatched agent instance (live admin status) |
| `voiceConnectedAt` | last kiosk connection heartbeat |

No LiveKit secret is ever stored in the database.

## Verification status

- Kiosk browser flow, admin console, 107 unit tests, 16 agent tests and 135 acceptance checks all pass with the voice layer in place.
- `POST /kiosk/voice/intake-token` issues a signed LiveKit token; the agent API returns `401` without `AGENT_API_KEY`.
- **LiveKit Cloud verified end to end:** a real WebRTC session was opened against
  `wss://<project>.livekit.cloud`, the agent worker registered as `voicehire-interview`, and
  LiveKit dispatched it into the room where it published an audio track the kiosk received.

## Deploying the agent

```bash
npm install
npm run start -w @proctor/voice-agent     # registers with LiveKit Cloud
```

The worker must run somewhere other than the kiosk. On Windows, keep the repository at a
**space-free path** — LiveKit's worker supervisor builds the child-process module path with
`pathToFileURL(p).pathname`, which drops the `file://` scheme and breaks when the path
contains a space.

The worker's name must equal the backend's `VOICE_AGENT_NAME`; set it with
`LIVEKIT_AGENT_NAME_OVERRIDE` in `apps/voice-agent/.env`.
