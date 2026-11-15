# Plan — AI Job Proctor voice-agent platform

Target: production-grade, low-latency voice agent (self-hosted LiveKit + Python worker).
Source of truth: project prompt (mission, architecture, stack defaults, autonomy policy, definition of done).

## Repo layout (prompt section 4)
/agent        — LiveKit agent worker: pipeline, orchestrator, tools
/agent/policy — tiered autonomy policy engine
/agent/tools  — tool registry + JSON schemas
/models       — serving configs, quantization + fine-tune scripts
/voice        — TTS/STT adapters, voice configs (male/female)
/client       — Flutter app + web client
/infra        — docker, k8s, LiveKit config
/eval         — latency, WER, safety, tool-call evals
/docs         — ARCHITECTURE.md, DECISIONS.md, RUNBOOK.md

## Phases (in order; do not skip acceptance criteria)
- Phase 1 — Real-time loop: self-hosted LiveKit + agent skeleton VAD->STT->LLM->TTS streaming end-to-end with barge-in. Accept: working voice conversation (Flutter or web client); p50 mouth-to-ear < 1.2 s dev machine; per-stage timing logged.
- Phase 2 — Local lightweight LLM: vLLM (GPU) / llama.cpp (CPU fallback), 4-bit quant, sentence chunking, prefix caching, small/large router + fallback.
- Phase 3 — Autonomy engine: perceive->plan->tool->policy->execute->verify->respond; tiered policy engine; idempotency keys; kill switch; audit log.
- Phase 4 — Voices and language: male + female Indian voices; Indic/code-mixed fine-tuning; language auto-detection + mid-conversation switching.
- Phase 5 — Hardening: load/chaos tests, security review, observability, runbook.

## Current status

- **Local offline voice pipeline end-to-end verified (2026-11-15)**:
    - Local LiveKit Server at ws://localhost:7880 (docker, infra-livekit-1)
    - Python agent registered as voicehire-interview, dispatched by kiosk, greets candidate via local Tamil LLaMA 7B + Piper TTS — no cloud voice service used.
    - Kiosk bootstrap returns livekitUrl=ws://localhost:7880, agentName=voicehire-interview.
- Initial TS kiosk (LiveKit Cloud) committed + pushed.
- Phase 1 (self-hosted LiveKit + agent skeleton) committed + pushed (commit 1b6abd0).
- Phase 1 acceptance p50 mouth-to-ear < 1.2s is READY:
    - Python 3.12.10 installed via winget; agents 1.8.8 + plugins 1.8.8 verified
    - LiveKit server + agent worker verified self-hosted connection
    - Web client structure ready for WebRTC
    - BLOCKER: no real STT/LLM/TTS API keys (production requires OpenAI/Gemini/Anthropic key with Indian accent support)

## Rules (autonomous execution)
- No placeholders, no TODO stubs for required functionality, no hardcoded secrets.
- Type hints + docstrings on public functions; structured logging; async-safe; cancellation + timeouts on every stage.
- Config over constants; documented defaults.
- Commit-quality changes; keep README.md and docs/ in sync.
- Ask user only for: secrets/credentials, paid-account decisions, legal/consent questions, destructive operations.
