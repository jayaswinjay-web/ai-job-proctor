"""Local LiveKit voice agent — fully offline Whisper STT + Tamil LLaMA + Piper TTS.

Fully self-hosted alternative to the LiveKit Cloud agent (apps/voice-agent).
The interview is driven exactly the same way: the script is authoritative — static
copy for the intake (language/job selection, consent) and the VoiceHire backend
engine for the questions themselves (via the /agent/* callback API). No LLM is used
for replies; turn detection is manual and transcripts are debounced into single
utterances (1.6s settle, same as the cloud agent).

Runs entirely on this machine:
    local LiveKit Server (ws://localhost:7880)
    Whisper (port 8095, CUDA)  -> streamed STT via StreamAdapter
    Piper Tamil (port 8095)    -> TTS
    backend API (port 4000)    -> jobs, questions, scoring, reports (all loopback)

No network calls leave the machine at runtime.

Run:
    python scripts/local-livekit-agent.py dev
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
import unicodedata
from pathlib import Path


def _load_repo_env() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    env_path = repo_root / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if value.startswith("\"") and value.endswith("\"") and len(value) >= 2:
            value = value[1:-1]
        if key.startswith("#") or not value:
            continue
        if key not in os.environ:
            os.environ[key] = value


_load_repo_env()

import re

import httpx
from livekit import agents, rtc
from livekit.agents import Agent, JobContext, WorkerOptions, cli
from livekit.agents.llm import ChatContext, ChatMessage, ChatChunk, ChoiceDelta, LLM, LLMStream
from livekit.agents.stt import STT, SpeechEvent
from livekit.agents.tts import TTS, ChunkedStream
from livekit.plugins import silero

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")
log = logging.getLogger("local-livekit-agent")

VOICE_SERVER = os.getenv("VOICE_SERVER_URL", "http://127.0.0.1:8095")
API_URL = os.getenv("VOICEHIRE_API_URL", "http://127.0.0.1:4000/api/v1")
AGENT_API_KEY = os.getenv("AGENT_API_KEY", "")
USER_UTTERANCE_SETTLE_MS = float(os.getenv("VOICE_USER_SETTLE_MS", "1600")) / 1000.0
REPLY_SETTLE_MS = float(os.getenv("VOICE_REPLY_SETTLE_MS", "400")) / 1000.0
RECOVERY_MS = float(os.getenv("VOICE_RECOVERY_MS", "4000")) / 1000.0
INTER_DIRECTIVE_PAUSE_MS = float(os.getenv("VOICE_INTER_PAUSE_MS", "250")) / 1000.0

_REPO = Path(__file__).resolve().parent.parent
_PHRASES = json.loads((_REPO / "scripts" / "voice-agent-phrases.json").read_text(encoding="utf-8"))["PHRASES"]


def copy(phrase: dict, language: str) -> str:
    return phrase.get(language) or phrase.get("ta") or phrase.get("en") or ""


def format_list(names: list[str], language: str) -> str:
    cleaned = [n for n in names if n]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]
    conjunction = " and " if language == "en" else " மற்றும் "
    return ", ".join(cleaned[:-1]) + conjunction + cleaned[-1]


def jobs_announcement(titles: list[str], language: str) -> str:
    return copy(_PHRASES["JOB_PROMPT"], language).replace("{list}", format_list(titles, language))


def languages_announcement(names: list[str], language: str) -> str:
    return copy(_PHRASES["LANGUAGE_PROMPT"], language).replace("{list}", format_list(names, language))


def normalize(value: str) -> str:
    v = unicodedata.normalize("NFKD", value)
    v = "".join(ch for ch in v if not unicodedata.combining(ch)).lower()
    v = re.sub(r"[^\w]", " ", v)
    v = re.sub(r"\s+", " ", v)
    return v.strip()


_LANGUAGE_ALIASES = {
    "en": ["english", "inglish", "angrezi", "anglam", "aangilam"],
    "hi": ["hindi", "hindhi", "हिन्दी", "हिंदी"],
    "mr": ["marathi", "marati", "maratthi", "मराठी"],
    "ta": ["tamil", "tamizh", "thamizh", "tamiz", "thamiz", "tamilar", "tamiḻ", "தமிழ்"],
}

_OPTION_SYNONYMS = {
    "factory": ["factory", "தொழிற்சாலை", "தொழிற்சாலை", "கார்ச்சாலை", "பாக்டரி", "ஃபாக்டரி", "कारखाना", "फैक्ट्री", "कामगार"],
    "worker": ["worker", "தொழிலாளி", "கூலி", "कामगार", "वर्कर", "मजदूर", "मज़दूर"],
    "delivery": ["delivery", "டெலிவரி", "விநியோகம்", "பார்சல்", "डिलीवरी", "पार्सल", "वितरण"],
    "security": ["security", "காவல்", "காவலர்", "காவலாளி", "சிச்சுவரிட்டி", "செக்யூரிட்டி", "सिक्योरिटी", "चौकीदार", "गार्ड"],
    "guard": ["guard", "காவலர்", "காவலாளி", "சிச்சுவரிட்டி", "காவல்", "गार्ड", "चौकीदार", "पहरेदार"],
    "sales": ["sales", "விற்பனை", "விற்பனையாளர்", "सेल्स", "बिक्री"],
    "assistant": ["assistant", "உதவியாளர்", "सहायक", "असिस्टेंट"],
    "driver": ["driver", "ஓட்டுநர்", "டிரைவர்", "चालक", "ड्राइवर"],
    "cleaner": ["cleaner", "சுத்தம்", "क्लीनर", "सफाई"],
    "cook": ["cook", "சமையல்", "कुक", "रसोइया"],
    "helper": ["helper", "உதவியாளர்", "हेल्पर", "मददगार"],
    "packing": ["packing", "பேக்கிங்", "पैकिंग"],
    "machine": ["machine", "இயந்திரம்", "मशीन"],
}

_ORDINALS = {
    "1": 1, "one": 1, "first": 1, "ஒன்று": 1, "முதல்": 1, "एक": 1, "पहला": 1,
    "2": 2, "two": 2, "second": 2, "இரண்டு": 2, "இரண்டாவது": 2, "दो": 2, "दूसरा": 2,
    "3": 3, "three": 3, "third": 3, "மூன்று": 3, "மூன்றாவது": 3, "तीन": 3, "तीसरा": 3,
    "4": 4, "four": 4, "fourth": 4, "நான்கு": 4, "चार": 4, "चौथा": 4,
    "5": 5, "five": 5, "fifth": 5, "ஐந்து": 5, "पांच": 5, "पाँच": 5,
}


def match_option(utterance: str, options: list[dict]):
    text = normalize(utterance)

    ordinal = _ORDINALS.get(text)
    if ordinal and ordinal <= len(options):
        return options[ordinal - 1]

    best = None  # (score, option)
    for option in options:
        base = [
            option.get("title"),
            option.get("name"),
            option.get("nativeName"),
            *_LANGUAGE_ALIASES.get(option.get("code", ""), []),
        ]
        base = [b for b in base if b]

        candidates = list(base)
        for value in base:
            for word in normalize(value).split():
                candidates.extend(_OPTION_SYNONYMS.get(word, []))

        for candidate in candidates:
            needle = normalize(candidate)
            if not needle:
                continue
            if needle in text:
                score = len(needle)
            elif any(len(w) > 3 and w in text for w in needle.split()):
                score = 3
            else:
                score = 0
            if score > 0 and (best is None or score > best[0]):
                best = (score, option)
    return best[1] if best else None


_REPEAT_PATTERNS = [
    r"\brepeat\b",
    r"say (that|it) again",
    r"come again",
    r"did(n[’']t| not) (understand|catch|hear)",
    r"what (are the )?(options|choices)",
    r"மீண்டும்",
    r"என்ன சொன்னீர்கள்",
    r"पुनः|दोबारा|फिर से",
    r"पुन्हा|परत",
]
_REPEAT_RE = [re.compile(p, re.IGNORECASE) for p in _REPEAT_PATTERNS]


def is_repeat_request(utterance: str) -> bool:
    return any(r.search(utterance) for r in _REPEAT_RE)


def is_options_request(utterance: str) -> bool:
    return re.search(r"(options|choices|list|என்னென்ன|என்ன வழிகள்|விருப்பங்கள்)", utterance, re.IGNORECASE) is not None


_AFFIRMATIVE = [
    r"^\s*(yes|yeah|yep|yup|correct|right|ok|okay|sure|fine|good)\b",
    r"\b(that'?s right|thats right|very good)\b",
    r"\b(i agree|agree|agreed|i accept|accept|consent|i consent|continue|proceed|go ahead)\b",
    r"\b(sammathikir\w*|sammathikkir\w*|oththukol\w*|oppukol\w*|thodaral\w*|thodangal\w*)\b",
    r"ஆம்|ஆமாம்|ஆமா|சரி|சரிதான்|ஓகே|சம்மதிக்கிறேன்|சம்மதிக்கிறார்|சம்மதம்|ஏற்றுக்கொள்கிறேன்|ஒப்புக்கொள்கிறேன்|ஒத்துக்கொள்கிறேன்|தொடரலாம்|தொடங்கலாம்|தொடர்கிறேன்|ஆமோதி",
    r"\b(aama|aamaa|aamam|aam|seri|sari|saree|sare|sheri|shari|sree|srii|siri|scri|seari|sarry)\b",
    r"हाँ|हां|ठीक|जी|अच्छा",
    r"\b(haan|han|haa|theek|thik|teek|ji|jii|acha|achha)\b",
    r"हो|बरं|बरोबर",
    r"\b(hoy|bar|barobar)\b",
]
_AFFIRMATIVE_RE = [re.compile(p, re.IGNORECASE) for p in _AFFIRMATIVE]

_NEGATIVE = [
    r"^\s*(no|nope|wrong|incorrect)\b",
    r"\b(i (do not|don't) agree|not agree|disagree|decline|refuse|reject)\b",
    r"\b(sammathikal\w*|sammathikkal\w*|oppukkal\w*)\b",
    r"இல்லை|இல்ல|வேண்டாம்|வேணாம்|வேண்டா|முடியாது|இயலாது|சம்மதிக்கவில்லை|ஒப்புக்கொள்ளவில்லை",
    r"\b(illa|illai|ille|ila|illanga|vendam|vendaam|venda)\b",
    r"नहीं|नही|गलत|मत",
    r"\b(nahi|nahin|nhi|galat|galath)\b",
]
_NEGATIVE_RE = [re.compile(p, re.IGNORECASE) for p in _NEGATIVE]


def is_affirmative(utterance: str) -> bool:
    return any(r.search(utterance) for r in _AFFIRMATIVE_RE)


def is_negative(utterance: str) -> bool:
    return any(r.search(utterance) for r in _NEGATIVE_RE)


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

    async def _recognize_impl(self, buffer, *, language, conn_options):
        import base64 as _b64

        from livekit.agents.stt import SpeechData, SpeechEventType

        if hasattr(buffer, "data"):
            raw = bytes(buffer.data)
        elif hasattr(buffer, "__iter__"):
            raw = b"".join(bytes(f.data) for f in buffer)
        else:
            raw = bytes(buffer)

        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{VOICE_SERVER}/transcribe",
                json={"audio_base64": _b64.b64encode(raw).decode("ascii"), "language": self._language},
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
# LLM: intentionally a no-op. The interview never calls it — the script is
# authoritative. With turn_detection='vad' the framework still fires LLM
# inference on every committed turn; returning an empty message instantly keeps
# that path silent instead of crashing or double-speaking with the directives.
# ---------------------------------------------------------------------------
class LocalTamilLLM(LLM):
    def chat(self, *, chat_ctx: ChatContext, tools=None, conn_options=None,
             parallel_tool_calls=None, tool_choice=None, extra_kwargs=None):
        class _Stream(LLMStream):
            async def _run(self) -> None:
                import uuid

                self._event_ch.send_nowait(
                    ChatChunk(
                        id=f"local-noop-{uuid.uuid4().hex[:12]}",
                        delta=ChoiceDelta(role="assistant", content=None, finish_reason="stop"),
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
                async with httpx.AsyncClient(timeout=120) as client:
                    r = await client.post(
                        f"{VOICE_SERVER}/synthesize",
                        json={"text": self._input_text, "voice": self._tts._voice},
                    )
                    r.raise_for_status()
                    wav = base64.b64decode(r.json()["wav_base64"])
                pcm = wav[44:] if wav[:4] == b"RIFF" else wav
                output_emitter.push(pcm)

        return _Chunk(tts=self, input_text=text, conn_options=conn_options)


# ---------------------------------------------------------------------------
# Backend callback client — the same endpoints the cloud TS agent uses.
# ---------------------------------------------------------------------------
class VoiceHireBackend:
    def __init__(self, base_url: str, api_key: str) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {"authorization": f"Bearer {api_key}"}
        self._client = httpx.AsyncClient(timeout=60, headers=self._headers)

    async def get_intake_context(self) -> dict:
        r = await self._client.get(f"{self._base}/agent/context")
        r.raise_for_status()
        return r.json()

    async def create_session(self, *, room_name: str, job_id: str, language_code: str,
                             consent_given: bool | None = None) -> dict:
        body: dict = {"roomName": room_name, "jobId": job_id, "languageCode": language_code}
        if consent_given is not None:
            body["consentGiven"] = consent_given
        r = await self._client.post(f"{self._base}/agent/sessions", json=body)
        r.raise_for_status()
        return r.json()

    async def consent(self, public_id: str, given: bool) -> dict:
        r = await self._client.post(f"{self._base}/agent/sessions/{public_id}/consent", json={"given": given})
        r.raise_for_status()
        return r.json()

    async def voice_turn(self, public_id: str, *, transcript: str,
                         spoken_language: str | None = None, confidence: float = 0.9) -> dict:
        r = await self._client.post(
            f"{self._base}/agent/sessions/{public_id}/turns",
            json={"transcript": transcript[:4000], "spokenLanguage": spoken_language, "confidence": confidence},
        )
        r.raise_for_status()
        return r.json()

    async def finish(self, public_id: str) -> dict:
        r = await self._client.post(f"{self._base}/agent/sessions/{public_id}/finish")
        r.raise_for_status()
        return r.json()

    async def agent_session(self, public_id: str, *, voice_agent_session_id: str, room_name: str) -> None:
        try:
            await self._client.post(
                f"{self._base}/agent/sessions/{public_id}/agent-session",
                json={"voiceAgentSessionId": voice_agent_session_id, "roomName": room_name},
            )
        except Exception:
            log.warning("agent-session callback failed (non-fatal)", exc_info=True)


_PHASE_ASK_LANGUAGE = "ASK_LANGUAGE"
_PHASE_CONFIRM_LANGUAGE = "CONFIRM_LANGUAGE"
_PHASE_ASK_JOB = "ASK_JOB"
_PHASE_CONFIRM_JOB = "CONFIRM_JOB"
_PHASE_CONSENT = "CONSENT"
_PHASE_INTERVIEW = "INTERVIEW"


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    backend = VoiceHireBackend(API_URL, AGENT_API_KEY)
    try:
        intake = await backend.get_intake_context()
    except Exception:
        log.exception("backend /agent/context failed — is the local API up and AGENT_API_KEY set?")
        intake = {"defaultLanguage": "ta", "jobs": [], "languages": [], "privacyNoticeRequired": False,
                  "supportedLanguages": ["ta", "en"]}

    language = intake.get("defaultLanguage") or "ta"
    jobs = intake.get("jobs", [])
    languages = intake.get("languages", [])
    log.info("intake context: %d jobs, %d languages, default=%s", len(jobs), len(languages), language)

    vad = silero.VAD.load(
        min_speech_duration=0.3,
        min_silence_duration=0.55,
    )
    stt = LocalWhisperSTT(language=language)
    llm = LocalTamilLLM()
    tts = LocalPiperTTS(voice="female")
    agent = Agent(
        instructions=(
            "You are the Rajapalayam Mills (Ramco Group) interview agent for a job screening kiosk. "
            f"Speak to the candidate in {language}. "
            "Understand natural speech and Tamil-English code-switching; never correct grammar. "
            "Never pass judgement on accent, dialect, literacy or background."
        ),
        vad=vad,
        stt=stt,
        llm=llm,
        tts=tts,
    )

    from livekit.agents import AgentSession
    from livekit.agents.stt import StreamAdapter

    adapted_stt = StreamAdapter(stt=stt, vad=vad)
    session = AgentSession(
        stt=adapted_stt,
        llm=llm,
        tts=tts,
        vad=vad,
        turn_handling={
            "turn_detection": "vad",
            "interruption": {"enabled": False},
        },
    )

    # --- Conversation state -------------------------------------------------
    state = {
        "phase": _PHASE_ASK_LANGUAGE,
        "language": language,
        "chosen_job": None,
        "chosen_language": None,
        "created": None,
        "last_prompt": "",
        "speaking": False,
        "busy": False,
        "pending_utterance": "",
        "pending_handle": None,
        "grace_until": 0.0,
    }

    async def speak(text: str, *, pause_ms: float = 0.0) -> None:
        clean = (text or "").strip()
        if not clean:
            return
        log.info("speak: %s", clean)
        state["speaking"] = True
        try:
            await session.say(clean, allow_interruptions=False)
        finally:
            state["speaking"] = False
            state["grace_until"] = time.time() + REPLY_SETTLE_MS
        if pause_ms:
            await asyncio.sleep(pause_ms / 1000.0)

    async def speak_directives(directives: list[dict]) -> list[dict]:
        spoken = []
        for d in directives:
            text = (d.get("text") or "").strip()
            if not text:
                continue
            await speak(text, pause_ms=INTER_DIRECTIVE_PAUSE_MS)
            spoken.append(d)
        return spoken

    def remember_question(directives: list[dict]) -> None:
        for d in reversed(directives):
            if d.get("text") and d.get("phraseKey") != "listening_prompt":
                state["last_prompt"] = d["text"]
                return

    async def publish_session_binding(created: dict) -> None:
        payload = json.dumps({
            "type": "session",
            "sessionId": created.get("sessionId"),
            "publicId": created.get("publicId"),
            "sessionSecret": created.get("sessionSecret"),
        }).encode("utf-8")
        try:
            await ctx.room.local_participant.publish_data(payload, reliable=True)
        except Exception:
            log.warning("failed to publish session binding", exc_info=True)

    async def begin_interview() -> None:
        chosen_job = state["chosen_job"]
        chosen_language = state["chosen_language"]
        room_name = ctx.room.name or "interview"
        created = await backend.create_session(
            room_name=room_name,
            job_id=chosen_job["id"],
            language_code=chosen_language["code"],
            consent_given=False,
        )
        state["created"] = created
        await backend.agent_session(
            created["publicId"],
            voice_agent_session_id=ctx.job.id or "local-agent",
            room_name=room_name,
        )
        await publish_session_binding(created)
        if intake.get("privacyNoticeRequired"):
            state["phase"] = _PHASE_CONSENT
            consent_text = copy(_PHRASES["CONSENT"], language)
            state["last_prompt"] = consent_text
            await speak(consent_text, pause_ms=200)
        else:
            await grant_consent()

    async def grant_consent() -> None:
        created = state["created"]
        payload = await backend.consent(created["publicId"], True)
        state["phase"] = _PHASE_INTERVIEW
        directives = [d for d in payload.get("directives", []) if d.get("text")]
        speakable = [
            d for d in directives
            if d.get("phraseKey") not in {"welcome", "consent_notice", "consent_ask_confirm"}
        ]
        spoken = await speak_directives(speakable)
        remember_question(spoken or directives)

    async def decline_consent() -> None:
        created = state["created"]
        state["phase"] = _PHASE_INTERVIEW
        payload = None
        try:
            payload = await backend.consent(created["publicId"], False)
        except Exception:
            log.warning("consent decline callback failed", exc_info=True)
        if payload:
            await speak_directives([d for d in payload.get("directives", []) if d.get("text")])
        else:
            await speak(copy(_PHRASES["READY"], language))

    async def handle_utterance(utterance: str) -> None:
        state["busy"] = True
        phase = state["phase"]
        try:
            # Pre-interview: "repeat"/"options" re-reads the last prompt.
            if phase != _PHASE_INTERVIEW and (
                is_repeat_request(utterance) or is_options_request(utterance)
            ):
                if state["last_prompt"]:
                    await speak(state["last_prompt"])
                return

            if phase == _PHASE_ASK_LANGUAGE:
                pick = match_option(utterance, languages)
                if not pick:
                    await speak(copy(_PHRASES["NOT_UNDERSTOOD"], language))
                    again = languages_announcement([l.get("nativeName") or l["name"] for l in languages], language)
                    state["last_prompt"] = again
                    await speak(again, pause_ms=300)
                    return
                state["chosen_language"] = pick
                state["language"] = pick.get("code", language)
                state["phase"] = _PHASE_CONFIRM_LANGUAGE
                confirm = copy(_PHRASES["LANGUAGE_CONFIRM"], state["language"]).replace(
                    "{language}", pick.get("nativeName") or pick["name"]
                )
                state["last_prompt"] = confirm
                await speak(confirm)
                return

            if phase == _PHASE_CONFIRM_LANGUAGE:
                confirm_language = state["language"]
                pick = state["chosen_language"]
                if is_affirmative(utterance):
                    state["phase"] = _PHASE_ASK_JOB
                    prompt = jobs_announcement([j["title"] for j in jobs], confirm_language)
                    state["last_prompt"] = prompt
                    await speak(prompt, pause_ms=300)
                    return
                if is_negative(utterance):
                    state["chosen_language"] = None
                    state["language"] = language
                    state["phase"] = _PHASE_ASK_LANGUAGE
                    again = languages_announcement(
                        [l.get("nativeName") or l["name"] for l in languages], language
                    )
                    state["last_prompt"] = again
                    await speak(again, pause_ms=300)
                    return
                confirm = copy(_PHRASES["LANGUAGE_CONFIRM"], confirm_language).replace(
                    "{language}", (pick or {}).get("nativeName") or (pick or {}).get("name", "")
                )
                state["last_prompt"] = confirm
                await speak(confirm)
                return

            if phase == _PHASE_ASK_JOB:
                job = match_option(utterance, jobs)
                if not job:
                    await speak(copy(_PHRASES["NOT_UNDERSTOOD"], state["language"]))
                    again = jobs_announcement([j["title"] for j in jobs], state["language"])
                    state["last_prompt"] = again
                    await speak(again, pause_ms=300)
                    return
                state["chosen_job"] = job
                state["phase"] = _PHASE_CONFIRM_JOB
                confirm = copy(_PHRASES["JOB_CONFIRM"], state["language"]).replace("{job}", job["title"])
                state["last_prompt"] = confirm
                await speak(confirm)
                return

            if phase == _PHASE_CONFIRM_JOB:
                job = state["chosen_job"]
                if is_affirmative(utterance):
                    await begin_interview()
                    return
                if is_negative(utterance):
                    state["chosen_job"] = None
                    state["phase"] = _PHASE_ASK_JOB
                    again = jobs_announcement([j["title"] for j in jobs], state["language"])
                    state["last_prompt"] = again
                    await speak(again, pause_ms=300)
                    return
                confirm = copy(_PHRASES["JOB_CONFIRM"], state["language"]).replace(
                    "{job}", (job or {}).get("title", "")
                )
                state["last_prompt"] = confirm
                await speak(confirm)
                return

            if phase == _PHASE_CONSENT:
                if is_affirmative(utterance):
                    await grant_consent()
                    return
                if is_negative(utterance):
                    await decline_consent()
                    return
                consent_text = copy(_PHRASES["CONSENT"], state["language"])
                state["last_prompt"] = consent_text
                await speak(consent_text)
                return

            if phase == _PHASE_INTERVIEW:
                created = state["created"]
                if not created:
                    return
                payload = await backend.voice_turn(
                    created["publicId"],
                    transcript=utterance,
                    spoken_language=state["language"],
                    confidence=0.9,
                )
                directives = payload.get("directives", [])
                spoken = await speak_directives(directives)
                remember_question(spoken)
                if payload.get("terminal") == "COMPLETED":
                    try:
                        await backend.finish(created["publicId"])
                    except Exception:
                        log.warning("finish callback failed", exc_info=True)
                    await speak(copy(_PHRASES["READY"], state["language"]))
                return
        except Exception:
            log.exception("turn handling failed; continuing")
        finally:
            state["busy"] = False

    def _flush_now() -> None:
        utterance = state["pending_utterance"].strip()
        state["pending_utterance"] = ""
        state["pending_handle"] = None
        if not utterance:
            return
        if state["busy"] or state["speaking"]:
            state["pending_utterance"] = utterance
            _schedule_flush(0.3)
            return
        asyncio.get_running_loop().create_task(handle_utterance(utterance))

    def _schedule_flush(delay: float = USER_UTTERANCE_SETTLE_MS) -> None:
        if state["pending_handle"] is not None:
            state["pending_handle"].cancel()
        loop = asyncio.get_running_loop()
        state["pending_handle"] = loop.call_later(delay, _flush_now)

    def on_user_input_transcribed(event) -> None:
        if not getattr(event, "is_final", False):
            return
        utterance = (getattr(event, "transcript", "") or "").strip()
        if not utterance:
            return
        log.info("final transcript: %r (phase=%s)", utterance, state["phase"])
        phase = state["phase"]
        if state["speaking"] is False and time.time() < state["grace_until"] and not state["pending_utterance"]:
            log.info("ignore (echo/settle): %s", utterance)
            return
        state["pending_utterance"] = f"{state['pending_utterance']} {utterance}".strip() if state["pending_utterance"] else utterance
        _schedule_flush()

    session.on("user_input_transcribed", on_user_input_transcribed)

    await session.start(agent=agent, room=ctx.room)

    # --- WELCOME (Tamil-first) and hand over to the handler -------------------
    await speak(copy(_PHRASES["GREETING"], language), pause_ms=200)
    if not languages:
        await speak(copy(_PHRASES["NOT_UNDERSTOOD"], language))
        return
    lang_prompt = languages_announcement([l.get("nativeName") or l["name"] for l in languages], language)
    state["last_prompt"] = lang_prompt
    await speak(lang_prompt, pause_ms=300)
    log.info("intake flow ready; waiting for candidate (phase=%s)", state["phase"])


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="voicehire-interview"))
