"""LiveKit voice agent worker entrypoint.

Phase 1 real-time loop: VAD (Silero) -> streaming STT -> turn detector ->
LLM -> streaming TTS -> LiveKit audio out, with barge-in.

Run:
    cd agent
    pip install -r requirements.txt
    LIVEKIT_URL=ws://localhost:7880 python -m src.main
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

from livekit import agents
from livekit.agents import VoicePipelineAgent

from .config import AgentConfig
from .pipeline import VoicePipeline

logger = logging.getLogger("voice-agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    """Connect to the LiveKit room and start the streaming agent."""
    await ctx.connect()
    config = AgentConfig()
    logger.info(
        "agent connecting",
        extra={"room": ctx.room.name, "url": config.livekit_url, "language": config.language},
    )

    # --- plugin wiring (verify exact plugin class names after pip install) ---
    from livekit.plugins import silero, openai  # noqa: PLC0415

    vad = silero.VAD()
    stt = openai.STT(model=config.stt_model, language=config.stt_language)
    llm = openai.LLM(model=config.llm_model)
    tts = openai.TTS(model=config.tts_model, voice=config.tts_voice_male)

    pipeline = VoicePipeline(config=config, room=ctx.room)
    agent = VoicePipelineAgent(
        vad=vad,
        stt=stt,
        llm=llm,
        tts=tts,
    )

    # Hook barge-in and per-stage timing onto the agent session events.
    session = agent.session
    pipeline.start(agent)

    @session.on("user_speech_committed")
    async def _on_user_speech(transcript: str) -> None:
        await pipeline.on_user_speech(transcript)

    agent.start(ctx.room)
    logger.info("agent started", extra={"room": ctx.room.name})

    # Keep the worker alive for the lifetime of the job.
    await asyncio.Event().wait()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
