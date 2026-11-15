"""Local GPU voice stack for the offline pipeline.

Serves on http://localhost:8095

Endpoints
    GET  /health                            liveness
    POST /transcribe  {audio_base64, language}   PCM/WAV base64 -> text (faster-whisper, CUDA)
    POST /generate    {messages}                 chat-ish turn via Tamil LLaMA (CUDA)
    POST /synthesize  {text, voice}              text -> WAV base64 (Piper Tamil)

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

        _whisper = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
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
        self._error(404, "not found")

    def do_POST(self) -> None:
        body = self._post_body()
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except json.JSONDecodeError:
            self._error(400, "invalid JSON")
            return

        if self.path == "/transcribe":
            self._transcribe(payload)
        elif self.path == "/generate":
            self._generate(payload)
        elif self.path == "/synthesize":
            self._synthesize(payload)
        else:
            self._error(404, "not found")

    def _transcribe(self, payload: dict) -> None:
        audio_b64 = payload.get("audio_base64")
        if not audio_b64:
            self._error(400, "audio_base64 required")
            return
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(base64.b64decode(audio_b64))
            tmp_path = tmp.name
        try:
            model = get_whisper()
            segments, _ = model.transcribe(tmp_path, beam_size=1, vad_filter=True)
            text = " ".join(s.text for s in segments).strip()
            self._json(200, {"text": text})
        except Exception:  # noqa: BLE001
            log.exception("transcribe failed")
            self._error(500, "transcribe failed")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

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
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            piper.synthesize_wav(text, wav)
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
