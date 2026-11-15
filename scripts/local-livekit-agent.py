"""Local LiveKit voice agent — fully offline Whisper STT + Tamil LLaMA + Piper TTS.

Connects to the local LiveKit Server at ws://localhost:7880 (already running, see
infra/docker-compose.yml).  Registers as `voicehire-interview`, so the kiosk can keep
its existing thin-client code path and just point LIVEKIT_URL at ws://localhost:7880.

Pipeline: Silero VAD -> faster-whisper (CTranslate2, CUDA) -> llama.cpp (CUDA) -> Piper (CUDA)
All inference happens on the local GPU.  No network calls are made at runtime.

Run:
    python scripts/local-livekit-agent.py
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from pathlib import Path

from livekit import agents, rtc
from livekit.agents import Agent, JobContext, WorkerOptions, cli
from livekit.agents.llm import ChatContext, ChatMessage, LLM, LLMStream
from livekit.agents.stt import STT, SpeechEvent
from livekit.agents.tts import TTS, ChunkedStream, SynthesizedAudio
from livekit.plugins import silero

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("local-livekit-agent")

VOICE_SERVER = os.getenv("VOICE_SERVER_URL", "http://127.0.0.1:8095")


# ---------------------------------------------------------------------------
# STT: faster-whisper via scripts/local-voice-server.py
# ---------------------------------------------------------------------------
class LocalWhisperSTT(STT):
    def __init__(self, *, language: str = "ta") -> None:
        super().__init__(model="faster-whisper-tiny", provider="local", capabilities={})
        self._language = language

    async def _recognize_impl(
        self,
        buffer,
        *,
        language: str | None = None,
        conn_options,
    ) -> SpeechEvent:
        import httpx

        # buffer is a recipes buffer of int16 PCM; base64-encode so we can POST it
        import struct

        audio_samples = bytes(buffer)
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{VOICE_SERVER}/transcribe",
                json={
                    "audio_base64": base64.b64encode(audio_samples).decode("ascii"),
                    "language": self._language,
                },
            )
            r.raise_for_status()
            text = r.json().get("text", "")

        return SpeechEvent(
            type="final_transcript",
            alternatives=[{"text": text}],
        )


# ---------------------------------------------------------------------------
# LLM: Tamil LLaMA 7B via llama.cpp through scripts/local-voice-server.py
# ---------------------------------------------------------------------------
class LocalTamilLLM(LLM):
    def __init__(self) -> None:
        super().__init__(model="tamil-llama-7b-base-v0.1-q4_k_m.gguf", provider="local")

    def chat(self, *, chat_ctx: ChatContext, tools=None, conn_options=None, parallel_tool_calls=None, tool_choice=None, extra_kwargs=None):
        import httpx

        async def _call():
            transcript = "\n".join(
                f"{m.role}: {m.text_content}" for m in chat_ctx.items if isinstance(m, ChatMessage)
            )
            r = httpx.post(
                f"{VOICE_SERVER}/generate",
                json={"messages": [{"role": "user", "content": transcript}], "max_tokens": 200},
                timeout=120,
            )
            r.raise_for_status()
            return r.json().get("text", "")

        class _Stream(LLMStream):
            async def _run(self) -> None:
                text = await _call()
                if text:
                    self._event_ch.send_nowait(
                        getattr(__import__("livekit.agents.llm", fromlist=["ChatChunk"]), "ChatChunk")(
                            delta=getattr(__import__("livekit.agents.llm", fromlist=["ChoiceDelta"]), "ChoiceDelta")(
                                role="assistant", content=text
                            ),
                            usage=None,
                        )
                    )
                self._event_ch.send_nowait(
                    getattr(__import__("livekit.agents.llm", fromlist=["ChatChunk"]), "ChatChunk")(
                        delta=getattr(__import__("livekit.agents.llm", fromlist=["ChoiceDelta"]), "ChoiceDelta")(
                            role="assistant", content=None, finish_reason="stop"
                        ),
                        usage=None,
                    )
                )

        return _Stream(llm=self, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options)


# ---------------------------------------------------------------------------
# TTS: Piper Tamil via scripts/local-voice-server.py
# ---------------------------------------------------------------------------
class LocalPiperTTS(TTS):
    def __init__(self, *, voice: str = "female") -> None:
        super().__init__(model=f"piper-ta_IN-{voice}", provider="local", sample_rate=22050, num_channels=1)
        self._voice = voice

    def synthesize(self, text: str, *, conn_options=None) -> ChunkedStream:
        import httpx

        class _Chunk(ChunkedStream):
            async def _main_task(self) -> None:
                r = httpx.post(
                    f"{VOICE_SERVER}/synthesize",
                    json={"text": text, "voice": self._tts._voice},
                    timeout=120,
                )
                r.raise_for_status()
                wav = base64.b64decode(r.json()["wav_base64"])
                audio = SynthesizedAudio(
                    request_id="local-piper",
                    frame=rtc.AudioFrame(
                        data=wav,
                        sample_rate=22050,
                        num_channels=1,
                        samples_per_channel=len(wav) // 2,
                    ),
                )
                self._event_ch.send_nowait(audio)

        return _Chunk(tts=self, input_text=text, conn_options=conn_options)


def entrypoint(ctx: JobContext) -> None:
    async def _run() -> None:
        vad = silero.VAD.load(min_speech_duration=0.3, min_silence_duration=0.55)
        stt = LocalWhisperSTT(language="ta")
        llm = LocalTamilLLM()
        tts = LocalPiperTTS(voice="female")
        agent = Agent(
            instructions="You are the interviewer of Rajapalayam Mills (Ramco Group).",
            vad=vad,
            stt=stt,
            llm=llm,
            tts=tts,
        )
        await agent.start(ctx)
        log.info("agent started and waiting")

    asyncio.run(_run())


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="voicehire-interview"))
