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
