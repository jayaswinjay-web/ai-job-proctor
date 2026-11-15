# Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Repo layout per prompt section 4 (/agent, /client, /infra, /models, /voice, /eval, /docs) | Matches the source-of-truth architecture. |
| 2 | Self-hosted LiveKit Server (not LiveKit Cloud) | Prompt requires self-hostable, deployable in an Indian cloud region. |
| 3 | Python 3.11+ agent worker; livekit-agents framework | Prompt stack default; do not reimplement WebRTC. |
| 4 | vLLM (GPU) primary, llama.cpp (CPU/edge fallback), 4-bit quant (AWQ/GPTQ/GGUF) | Prompt stack default; cost-aware, Indian cloud region deployable. |
| 5 | Whisper-family streaming STT fine-tuned for Indian English/Indic | Prompt stack default; Indic capability. |
| 6 | Streaming TTS fine-tuned on licensed Indian voice data (male + female) | Prompt stack default; DPDP Act 2023 consent provenance in /voice/PROVENANCE.md. |
| 7 | Postgres + Redis + pgvector (or Qdrant) | Prompt stack default. |
| 8 | Desktop launcher starts Postgres, API, kiosk, admin, camera and two Python local voice services | One-click start; verified end-to-end 2026-11-15. Local voice server (:8095) is required before the local agent (agent registration on ws://localhost:7880) can be dispatched. The local agent reads repo `.env` itself so the desktop icon's `cmd` environment doesn't need to carry `LIVEKIT_URL` explicitly. |
| 9 | Kiosk points to local LiveKit Server; voice agent is Python local agent (not TS/LiveKit Cloud agent) | Prompt requires fully-offline operation; the rebranding is `voicehire-interview` in both the local Gemma/LiteLLM backup or Python local agent. |
| 10 | `start-all-lib.ps1` probes both `InterNetwork` and `InterNetworkV6` (Vite binds `::1` , API binds `0.0.0.0`) | Prevents the "Admin/Kiosk never came up" launcher bug observed 2026-11-15. |
| 11 | Fully offline deployment: set `EVALUATION_PROVIDER=rules` (deterministic rubric, no LLM call) + `STT_PROVIDER=browser` + `TTS_PROVIDER=browser` + `LLM_PROVIDER=livekit` unused at runtime | Verified 2026-11-15: API boot logs show `"evaluation":"rules"`, and no runtime network calls. Local Whisper + Tamil LLaMA + Piper all run on CUDA on the same machine. Docker/Postgres/LiveKit all run on `127.0.0.1`. Anything beyond this swap remains remote. |
