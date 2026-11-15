"""Local GPU voice stack for the offline pipeline.

Serves on http://localhost:8095

Endpoints
    GET  /health                            liveness
    OPTIONS *                               204 (used by API health checks)
    POST /transcribe  {audio_base64, language}   PCM/WAV base64 -> text (faster-whisper, CUDA)
    POST /generate    {messages}                 chat-ish turn via Tamil LLaMA (CUDA)
    POST /synthesize  {text, voice}              text -> WAV base64 (Piper Tamil)
    POST /v1/audio/transcriptions               OpenAI-compatible verbose_json (for STT_PROVIDER=whisper-http)

No network access is required at runtime; all models live under F:/models and F:/voice.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import sys
import tempfile
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("local-voice")

HOST = os.getenv("VOICE_HOST", "127.0.0.1")
PORT = int(os.getenv("VOICE_PORT", "8095"))

WHISPER_MODEL = os.getenv("WHISPER_MODEL", r"F:\models\faster-whisper-tiny")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "float16")
LLAMA_GGUF = os.getenv("LLAMA_GGUF", r"F:\models\tamil-llama-7b-base-v0.1-gguf\tamil-llama-7b-base-v0.1-q4_k_m.gguf")
PIPER_FEMALE = os.getenv("PIPER_FEMALE", r"F:\voice\ta_IN-HemaLatha-medium\ta_IN-HemaLatha-medium.onnx")
PIPER_MALE = os.getenv("PIPER_MALE", r"F:\voice\ta_IN-ValluvarNeural-medium\ta_IN-ValluvarNeural-medium.onnx")
N_GPU_LAYERS = int(os.getenv("N_GPU_LAYERS", "99"))

_whisper = None
_llama = None
_piper_female = None
_piper_male = None


def get_whisper():
    global _whisper
    if _whisper is None:
        log.info("loading whisper from %s", WHISPER_MODEL)
        from faster_whisper import WhisperModel

        _whisper = WhisperModel(WHISPER_MODEL, device="cuda", compute_type=WHISPER_COMPUTE)
        log.info("whisper loaded")
    return _whisper


def get_llama():
    global _llama
    if _llama is None:
        log.info("loading tamil-llama from %s", LLAMA_GGUF)
        from llama_cpp import Llama

        _llama = Llama(
            model_path=LLAMA_GGUF,
            n_gpu_layers=N_GPU_LAYERS,
            n_ctx=1024,
            n_threads=int(os.getenv("N_THREADS", "4")),
            verbose=False,
        )
        log.info("tamil-llama loaded")
    return _llama


def get_piper(voice: str):
    global _piper_female, _piper_male
    if voice == "female":
        if _piper_female is None:
            from piper import PiperVoice

            log.info("loading female voice %s", PIPER_FEMALE)
            _piper_female = PiperVoice.load(PIPER_FEMALE)
            log.info("female voice loaded")
        return _piper_female
    if _piper_male:
        return _piper_male
    from piper import PiperVoice

    log.info("loading male voice %s", PIPER_MALE)
    _piper_male = PiperVoice.load(PIPER_MALE)
    log.info("male voice loaded")
    return _piper_male


class Handler(BaseHTTPRequestHandler):
    server_version = "local-voice/1.0"

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)

    def _json(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, code: int, message: str) -> None:
        self._json(code, {"error": message})

    def _post_body(self) -> bytes:
        length = int(self.headers.get("content-length", "0"))
        return self.rfile.read(length)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok", "models": ["whisper", "tamil-llama", "piper"]})
            return
        if self.path == "/v1/models":
            self._json(200, {
                "object": "list",
                "data": [
                    {"id": Path(LLAMA_GGUF).stem, "object": "model", "owned_by": "local"},
                    {"id": Path(WHISPER_MODEL).name, "object": "model", "owned_by": "local"},
                ],
            })
            return
        self._error(404, "not found")

    def do_OPTIONS(self) -> None:
        # The API's whisper-http provider probes the endpoint with OPTIONS before use.
        self.send_response(204)
        self.send_header("allow", "GET, POST, OPTIONS")
        self.send_header("content-length", "0")
        self.end_headers()

    def do_POST(self) -> None:
        body = self._post_body()
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except json.JSONDecodeError:
            self._error(400, "invalid JSON")
            return

        if self.path == "/transcribe":
            self._transcribe(payload)
        elif self.path == "/v1/audio/transcriptions":
            self._transcriptions(payload)
        elif self.path == "/generate":
            self._generate(payload)
        elif self.path == "/synthesize":
            self._synthesize(payload)
        else:
            self._error(404, "not found")

    def _whisper_segments(self, raw: bytes, language: str | None):
        """Run faster-whisper over uploaded bytes.

        Handles RIFF/WAVE, EBML (.webm), OggS (.ogg), MP3 (ID3/frame sync), FLAC,
        and raw int16 16kHz mono PCM. Returns (segments_list, language, duration_s).
        """
        model = get_whisper()
        lang = (language or "ta").strip() or "ta"

        def _detect_suffix(b: bytes) -> str | None:
            if b[:4] == b"RIFF" and b"WAVE" in b[:12]:
                return ".wav"
            if b[:4] == b"\x1a\x45\xdf\xa3":
                return ".webm"
            if b[:4] == b"OggS":
                return ".ogg"
            if b[:3] == b"ID3" or b[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
                return ".mp3"
            if b[:4] == b"fLaC":
                return ".flac"
            return None

        suffix = _detect_suffix(raw)
        if suffix is not None:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            try:
                # Caller (LiveKit VAD) already trimmed silence; re-filtering clips short utterances.
                segments, info = model.transcribe(tmp_path, beam_size=1, vad_filter=False, language=lang)
                seg_list = list(segments)
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        else:
            # Raw int16 16kHz mono PCM -> float32 normalized array
            import numpy as np
            pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            segments, info = model.transcribe(pcm, beam_size=1, vad_filter=False, language=lang)
            seg_list = list(segments)
        duration = float(getattr(info, "duration", 0.0) or 0.0)
        detected = getattr(info, "language", None) or lang
        return seg_list, detected, duration

    def _transcribe(self, payload: dict) -> None:
        audio_b64 = payload.get("audio_base64")
        if not audio_b64:
            self._error(400, "audio_base64 required")
            return
        raw = base64.b64decode(audio_b64)
        try:
            seg_list, _detected, _duration = self._whisper_segments(raw, payload.get("language"))
            text = " ".join(s.text for s in seg_list).strip()
            self._json(200, {"text": text})
        except Exception:  # noqa: BLE001
            log.exception("transcribe failed")
            self._error(500, "transcribe failed")

    def _transcriptions(self, payload: dict) -> None:
        """OpenAI-compatible Whisper verbose_json shape (for STT_PROVIDER=whisper-http)."""
        audio_b64 = payload.get("audio")
        if not audio_b64:
            self._error(400, "audio (base64) required")
            return
        raw = base64.b64decode(audio_b64)
        try:
            language = payload.get("language")
            seg_list, detected, duration = self._whisper_segments(raw, language)
            segments = [
                {
                    "start": float(s.start),
                    "end": float(s.end),
                    "text": s.text,
                    "avg_logprob": float(getattr(s, "avg_logprob", -0.2) or -0.2),
                }
                for s in seg_list
            ]
            text = " ".join(s["text"] for s in segments).strip()
            self._json(200, {
                "text": text,
                "language": detected,
                "duration": duration,
                "segments": segments,
            })
        except Exception:  # noqa: BLE001
            log.exception("transcription failed")
            self._error(500, "transcription failed")

    def _generate(self, payload: dict) -> None:
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            self._error(400, "messages required")
            return
        # Base Tamil LLaMA is a raw completion model, so build a continuation prompt
        system_prompt = (
            payload.get("system")
            or "You are a helpful Tamil speaking assistant. Respond in Tamil."
        )
        transcript = "\n".join(
            f"{m.get('role','user')}: {m.get('content','')}" for m in messages
        )
        prompt = f"{system_prompt}\n\n{transcript}\nassistant:"
        llm = get_llama()
        out = llm(prompt, max_tokens=int(payload.get("max_tokens", 120)), temperature=float(payload.get("temperature", 0.6)))
        text = out["choices"][0]["text"].strip()
        self._json(200, {"text": text, "model": Path(LLAMA_GGUF).name})

    def _synthesize(self, payload: dict) -> None:
        text = payload.get("text")
        if not text:
            self._error(400, "text required")
            return
        voice = payload.get("voice", "female")
        piper = get_piper(voice)
        volume = float(payload.get("volume", 1.0) or 1.0)
        try:
            from piper.config import SynthesisConfig
            cfg = SynthesisConfig(volume=volume)
        except Exception:
            cfg = None
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            piper.synthesize_wav(text, wav, cfg)
        wav_bytes = buffer.getvalue()
        self._json(
            200,
            {
                "wav_base64": base64.b64encode(wav_bytes).decode("ascii"),
                "bytes": len(wav_bytes),
            },
        )


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("local-voice listening on http://%s:%d", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("stopped")
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
