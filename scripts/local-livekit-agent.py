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
        from livekit.agents.stt import STTCapabilities
        super().__init__(
            capabilities=STTCapabilities(
                streaming=False,
                interim_results=False,
                offline_recognize=True,
            )
        )
        self._language = language

    async def _recognize_impl(
        self,
        buffer,
        *,
        language,
        conn_options,
    ):
        import httpx
        from livekit.agents.stt import SpeechData, SpeechEvent, SpeechEventType
        from livekit.rtc import AudioFrame

        if hasattr(buffer, "data"):
            raw = bytes(buffer.data)
        elif hasattr(buffer, "__iter__"):
            raw = b"".join(bytes(f.data) for f in buffer)
        else:
            raw = bytes(buffer)

        base64_audio = base64.b64encode(raw).decode("ascii")
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{VOICE_SERVER}/transcribe",
                json={"audio_base64": base64_audio, "language": self._language},
            )
            r.raise_for_status()
            text = r.json().get("text", "")

        return SpeechEvent(
            type=SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[
                SpeechData(text=text, language=self._language, confidence=0.9),
            ],
        )


# ---------------------------------------------------------------------------
# LLM: Tamil LLaMA 7B via llama.cpp through scripts/local-voice-server.py
# ---------------------------------------------------------------------------
class LocalTamilLLM(LLM):
    def __init__(self) -> None:
        super().__init__()

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
        from livekit.agents.tts import TTSCapabilities
        super().__init__(
            capabilities=TTSCapabilities(streaming=False),
            sample_rate=22050,
            num_channels=1,
        )
        self._voice = voice

    def synthesize(self, text: str, *, conn_options=None) -> ChunkedStream:
        import httpx

        class _Chunk(ChunkedStream):
            async def _run(self, output_emitter) -> None:
                request_id = f"local-piper-{abs(hash(self._input_text))}"
                output_emitter.initialize(
                    request_id=request_id,
                    sample_rate=22050,
                    num_channels=1,
                    mime_type="audio/pcm",
                    stream=False,
                )

                r = httpx.post(
                    f"{VOICE_SERVER}/synthesize",
                    json={"text": self._input_text, "voice": self._tts._voice},
                    timeout=120,
                )
                r.raise_for_status()
                wav = base64.b64decode(r.json()["wav_base64"])
                # Piper outputs a WAV container; for PCM-supported emitter push raw bytes.
                # Re-wrap as raw PCM: strip the 44-byte WAV header.
                pcm = wav[44:] if wav[:4] == b"RIFF" else wav
                output_emitter.push(pcm)

        return _Chunk(tts=self, input_text=text, conn_options=conn_options)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
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
    from livekit.agents import AgentSession
    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        vad=vad,
    )
    await session.start(agent=agent, room=ctx.room)
    # Speak a greeting so the kiosk (and any candidate voice) hears the agent.
    await session.say(
        "வணக்கம்! ராஜபாளையம் மில்ஸ் (ராம்கோ குழுமம்) நேர்காணலுக்கு வரவேற்கிறோம். நான் உங்கள் நேர்காணலை குரல் மூலம் நடத்துவேன். திரையைத் தொட வேண்டிய அவசியம் இல்லை.",
        allow_interruptions=False,
    )
    log.info("agent greeted candidate and waiting")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="voicehire-interview"))
