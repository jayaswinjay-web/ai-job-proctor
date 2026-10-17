"""Streaming orchestration for the voice agent.

Owns per-stage timing and barge-in handling: on user speech, cancel in-flight
TTS + LLM generation, flush the audio buffer, and keep the partial reply in
context (prompt section 5).
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from .config import AgentConfig, StageTiming

logger = logging.getLogger("voice-agent.pipeline")


@dataclass
class VoicePipeline:
    """Thin orchestration wrapper around the LiveKit agent session.

    start/stop wrap VoicePipelineAgent; on_user_speech triggers barge-in:
    cancel generation/TTS, flush audio, retain partial reply in context.
    """

    config: AgentConfig
    room: object
    agent: object = field(init=False, repr=False)
    _generation_task: asyncio.Task | None = field(default=None, repr=False)
    _tts_task: asyncio.Task | None = field(default=None, repr=False)
    _timings: list[StageTiming] = field(default_factory=list, repr=False)
    _partial_reply: str = field(default="", repr=False)

    def start(self, agent: object) -> None:
        self.agent = agent
        logger.info("pipeline started")

    async def on_user_speech(self, transcript: str) -> None:
        """Barge-in: cancel in-flight generation/TTS and flush audio."""
        logger.info("barge-in triggered", extra={"transcript": transcript})
        self._cancel_generation()
        self._cancel_tts()
        await self._flush_audio()
        # partial reply stays in context; do not reset _partial_reply here
        logger.info("barge-in complete; partial reply retained")

    def _cancel_generation(self) -> None:
        if self._generation_task and not self._generation_task.done():
            self._generation_task.cancel()
            self._generation_task = None

    def _cancel_tts(self) -> None:
        if self._tts_task and not self._tts_task.done():
            self._tts_task.cancel()
            self._tts_task = None

    async def _flush_audio(self) -> None:
        # Flush the playout buffer so interrupted audio stops immediately.
        if self.agent and hasattr(self.agent, "flush_playout"):
            try:
                await self.agent.flush_playout()
            except Exception as exc:  # noqa: BLE001
                logger.warning("flush_playout failed", extra={"error": str(exc)})

    def log_timing(self, timing: StageTiming) -> None:
        self._timings.append(timing)
        logger.info(
            "stage timing",
            extra={
                "stage": timing.stage,
                "latency_ms": timing.latency_ms,
                "ok": timing.ok,
                "error": timing.error,
            },
        )

    @property
    def p50_mouth_to_ear_ms(self) -> float | None:
        lats = [t.latency_ms for t in self._timings if t.latency_ms is not None]
        if not lats:
            return None
        lats.sort()
        mid = len(lats) // 2
        return lats[mid]
