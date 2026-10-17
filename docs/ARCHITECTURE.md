# Architecture — AI Job Proctor voice-agent platform

Client (Flutter / Web / SIP phone)
  -> WebRTC (Opus) -> LiveKit Server (self-hosted)
  -> Agent Worker (Python, async)
       VAD (Silero) -> noise suppression
       -> Streaming STT (Indic-capable, Whisper-family)
       -> Turn detector (silence + semantic completeness)
       -> Orchestrator
            LLM (quantized, streaming, constrained tool-calling)
            Planner + Tool Registry
            Policy Engine (deterministic code, NOT the LLM)
            Memory (Redis session + vector long-term)
       -> Streaming TTS (male + female Indian voices, sentence-chunked)
       -> audio out via LiveKit
Side systems: Postgres, Redis, pgvector/Qdrant, object storage, OpenTelemetry traces, Prometheus metrics, audit log, admin console.

Keep every stage streaming. Never wait for a full transcript or a full LLM response when a partial one can be acted on.
