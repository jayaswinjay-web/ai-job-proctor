# VoiceHire Cloud Voice Agent

This package is the **remote AI voice agent** that conducts the interview over **LiveKit
Cloud**. It must run in the cloud — never on the kiosk and never inside the VoiceHire web
application.

```
Kiosk (thin client)  ──WebRTC──▶  LiveKit Cloud  ──▶  this agent (STT + LLM + TTS)
                                       ▲
                                       │  callbacks (AGENT_API_KEY)
                                       ▼
                              VoiceHire backend (jobs, questions, scoring, reports)
```

## Why it lives outside the web app

Per the architecture requirements, the kiosk and the Hatchable/VoiceHire web host must not
run media servers, STT, TTS, LLM inference or the agent. Only this worker does, and it is
deployed separately.

## Providers — no third-party keys required

All speech and language models run through **LiveKit's own agent gateway**
(`https://agent-gateway.livekit.cloud/v1`) and authenticate with the project's
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. **You do not need Deepgram, ElevenLabs, OpenAI or
Google accounts.** Usage is billed to the LiveKit project as inference credits.

| Function | Default model (override via env) | Capability |
|---|---|---|
| STT | `speechmatics/linden-1` (`en_ta`) | Tamil + English code-switching (Tamil, English; also `hi`, `mr`) |
| LLM | `google/gemini-2.5-flash` | conversation, intent, follow-ups |
| TTS | `cartesia/sonic-3` | multilingual speech, Tamil voice |

Alternatives available through the same gateway (e.g. STT `deepgram/nova-3`,
`cartesia/ink-whisper` with `VOICE_STT_LANGUAGE=ta`, `google/gemini-3.5-transcribe-live`; LLM
`openai/gpt-4o-mini`; TTS `deepgram/aura-2`, `rime/mistv3`) — change them with
`VOICE_STT_MODEL`, `VOICE_LLM_MODEL`, `VOICE_TTS_MODEL`.

## Environment

Server-side only. Never ship these to the browser. Stored in `apps/voice-agent/.env`
(gitignored).

| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | `wss://<project>.livekit.cloud` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Worker registration **and** inference gateway auth |
| `LIVEKIT_AGENT_NAME_OVERRIDE` | **Must equal** the backend's `VOICE_AGENT_NAME`, or rooms never dispatch to this worker |
| `VOICEHIRE_API_URL` | e.g. `http://localhost:4000/api/v1` |
| `AGENT_API_KEY` | Shared secret; must match the backend |
| `VOICE_STT_MODEL` / `VOICE_LLM_MODEL` / `VOICE_TTS_MODEL` | Optional model overrides |
| `VOICE_STT_LANGUAGE` / `VOICE_TTS_LANGUAGE` | Default `en_ta` / `ta` |

## Install & run

```bash
# from the repo root
npm install

npm run start -w @proctor/voice-agent
```

Verified working: the worker registers with LiveKit Cloud as `voicehire-interview` and is
dispatched into a room when the kiosk joins, publishing an audio track the kiosk plays.

> **Windows note:** LiveKit's worker supervisor builds the child-process module path with
> `pathToFileURL(p).pathname`, which drops the `file://` scheme. If the repository path
> contains a **space**, the supervisor fails with `ERR_MODULE_NOT_FOUND`. Keep the repo at a
> space-free path (e.g. `F:\voicehire`) when running the agent on Windows.

## Deploy

Deploy this worker using a LiveKit-supported mechanism (LiveKit Cloud Agents or a small
container host such as Fly/Render). It exposes no public HTTP surface; it dials out to
LiveKit Cloud. Set the environment variables above in the host's secret store.

Register the worker under the same agent name as `VOICE_AGENT_NAME` in the backend
(`voicehire-interview` by default) so room dispatch reaches it.

## Language support

Tamil is primary (`ta-IN`). The STT auto-detects Tamil, Hindi, Marathi and English, so
Tamil-English code-switching is understood without the candidate being forced to pick one
language per sentence. The agent reads out **all** jobs and **all** languages from the
backend, never a hard-coded list. If a new language is enabled in VoiceHire, it is announced
automatically.

## Not verified in this repo

The worker **type-checks and compiles against the pinned `@livekit/agents` 1.9.1 API**, and
the SDK calls are real. It cannot be *run* end-to-end here because that needs a LiveKit
Cloud project plus Deepgram / ElevenLabs / Gemini credentials. The conversation logic
(`src/conversation.ts`) and the backend client (`src/backend.ts`) are SDK-independent and
covered by unit tests.
