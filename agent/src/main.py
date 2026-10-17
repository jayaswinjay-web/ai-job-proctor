"""LiveKit voice agent worker entrypoint (Phase 1 skeleton).

Connects to the self-hosted LiveKit Server and runs the streaming pipeline:
VAD -> STT -> turn detection -> LLM -> streaming TTS -> LiveKit audio out,
with barge-in and per-stage timing.

IMPORTANT (environment constraint):
  livekit-agents 2.0 is the only release that installs on this machine's
  Python 3.14.2. Its STT/LLM/TTS/VAD plugin implementations are NOT yet
  published (the 1.x plugins need Python <3.14). The *_Stub classes below are
  development stubs: they satisfy the interfaces, log per-stage timing, and let
  the LiveKit connection + pipeline structure be verified. They produce no real
  speech. Replace them with real implementations (plugin + API key, or a local
  quantized LLM via vLLM/llama.cpp) before measuring p50 mouth-to-ear.

Run:
    cd agent
    pip install -r requirements.txt
    LIVEKIT_URL=ws://localhost:7880 python -m src.main
"""
from __future__ import annotations

import asyncio
import logging
import time

from livekit import agents
from livekit.agents import Agent, AgentSession
from livekit.agents.llm import LLM, ChatContext, ChatMessage, LLMStream
from livekit.agents.stt import STT, SpeechEvent, SpeechEventType
from livekit.agents.tts import TTS
from livekit.agents.vad import VAD, VADEvent, VADEventType, VADStream

from .config import AgentConfig
from .pipeline import VoicePipeline

logger = logging.getLogger("voice-agent")


# ---------------------------------------------------------------------------
# Development stubs — satisfy the interfaces and log per-stage timing.
# NOT a real voice conversation; replace with real plugin implementations.
# ---------------------------------------------------------------------------
class StubVAD(VAD):
    """Emits one framed speech segment so the pipeline can be exercised."""

    async def stream(self) -> VADStream:
        t0 = time.perf_counter() * 1000.0
        logger.info("stt vad segment start")
        yield VADEvent(type=VADEventType.START_OF_SPEECH)
        await asyncio.sleep(0.15)
        yield VADEvent(type=VADEventType.END_OF_SPEECH)
        logger.info("stt vad segment end latency_ms=%.1f", (time.perf_counter() * 1000.0) - t0)


class StubSTT(STT):
    """Returns a fixed transcript; logs STT stage timing."""

    async def _recognize_impl(self, buffer, *, language, conn_options):
        t0 = time.perf_counter() * 1000.0
        yield SpeechEvent(
            type=SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[{"text": "hello", "language": language or "en-IN"}],
        )
        logger.info("stt stage latency_ms=%.1f transcript=hello", (time.perf_counter() * 1000.0) - t0)


class StubLLM(LLM):
    """Returns a fixed reply; logs LLM stage timing."""

    async def chat(self, chat_ctx, *, conn_options=None):
        t0 = time.perf_counter() * 1000.0
        reply = "Hello, this is the Rajapalayam Mills voice agent."
        yield LLMStream(
            chat_ctx=chat_ctx,
            message=ChatMessage(role="assistant", content=reply),
        )
        logger.info("llm stage latency_ms=%.1f", (time.perf_counter() * 1000.0) - t0)


class StubTTS(TTS):
    """Emits silence; logs TTS stage timing."""

    async def synthesize(self, text, *, conn_options=None):
        t0 = time.perf_counter() * 1000.0
        # No real audio produced by the stub.
        logger.info("tts stage latency_ms=%.1f text=%r", (time.perf_counter() * 1000.0) - t0, text)
        return None


async def entrypoint(ctx: agents.JobContext) -> None:
    """Connect to the LiveKit room and start the streaming agent."""
    await ctx.connect()
    config = AgentConfig()
    logger.info(
        "agent connecting",
        extra={"room": ctx.room.name, "url": config.livekit_url, "language": config.language},
    )

    pipeline = VoicePipeline(config=config, room=ctx.room)

    agent = Agent(
        instructions=(
            "You are a voice interviewer for Rajapalayam Mills (Ramco Group). "
            "Speak in Indian English. Be concise."
        ),
        vad=StubVAD(),
        stt=StubSTT(),
        llm=StubLLM(),
        tts=StubTTS(),
    )

    session = AgentSession()
    pipeline.start(agent)

    @session.on("user_speech_committed")
    async def _on_user_speech(transcript: str) -> None:
        await pipeline.on_user_speech(transcript)

    await session.start(agent=agent, room=ctx.room)
    logger.info("agent started and registered", extra={"room": ctx.room.name})

    # Keep the worker alive for the lifetime of the job.
    await asyncio.Event().wait()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
