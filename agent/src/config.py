"""Configuration over constants for the voice agent worker.

Models, thresholds, voices, tier limits and timeouts live here with documented
defaults so they can be changed without touching code.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentConfig:
    # LiveKit Cloud / self-hosted server connection.
    livekit_url: str = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
    livekit_api_key: str = os.getenv("LIVEKIT_API_KEY", "devkey")
    livekit_api_secret: str = os.getenv("LIVEKIT_API_SECRET", "devsecret")

    # Language (Indian English primary; Tamil/Hindi on the roadmap).
    language: str = os.getenv("AGENT_LANGUAGE", "en-IN")
    stt_language: str = os.getenv("STT_LANGUAGE", "en-IN")

    # Models. Phase 1 accepts an API or local LLM; Phase 2 swaps to a local
    # quantized model served by vLLM / llama.cpp.
    stt_model: str = os.getenv("STT_MODEL", "whisper-1")          # verify: streaming Whisper-family
    llm_model: str = os.getenv("LLM_MODEL", "gpt-4o-mini")         # Phase 1; local model in Phase 2
    tts_model: str = os.getenv("TTS_MODEL", "tts-1")
    tts_voice_male: str = os.getenv("TTS_VOICE_MALE", "alloy")
    tts_voice_female: str = os.getenv("TTS_VOICE_FEMALE", "alloy")

    # Turn detection & streaming behaviour.
    turn_silence_ms: int = int(os.getenv("TURN_SILENCE_MS", "700"))
    max_llm_tokens: int = int(os.getenv("MAX_LLM_TOKENS", "512"))
    tts_sentence_chunk: bool = os.getenv("TTS_SENTENCE_CHUNK", "1") == "1"

    # Latency targets (prompt section 9): p50 mouth-to-ear < 800 ms target,
    # dev-machine Phase 1 acceptance is < 1.2 s.
    mouth_to_ear_p50_target_ms: int = int(os.getenv("M2E_P50_TARGET_MS", "1200"))

    # Autonomy policy tier limits (prompt section 6).
    tier_2_cost_limit: float = float(os.getenv("TIER_2_COST_LIMIT", "0.00"))


@dataclass(frozen=True)
class StageTiming:
    """Per-stage latency log entry (structured logging friendly)."""
    stage: str
    start_ms: float
    end_ms: float | None = None
    latency_ms: float | None = None
    ok: bool = True
    error: str | None = None

    def finish(self, ok: bool = True, error: str | None = None) -> "StageTiming":
        self.end_ms = time.perf_counter() * 1000.0
        self.latency_ms = self.end_ms - self.start_ms
        self.ok = ok
        self.error = error
        return self


import time  # noqa: E402  (kept below dataclass for readability)
