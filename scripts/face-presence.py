#!/usr/bin/env python3
"""
Face-presence sidecar for the kiosk.

Runs on the kiosk machine, owns the webcam with OpenCV, and answers a single question
over HTTP: "is a person standing in front of the camera right now?". The kiosk polls it
and only lets the voice agent speak once a face has appeared.

Why a separate process:
  * The browser cannot reliably open the same webcam as a native app, and face detection
    in-page needs an experimental API or a large WASM model plus CSP changes. A tiny local
    service keeps the kiosk thin.
  * It is deliberately dependency-light: OpenCV + the Python standard library only. No
    Flask, no cloud calls, no data leaves the machine — frames are never written or sent.

Endpoints (default host 127.0.0.1, port 8090):
  GET /presence -> {"face": bool, "count": int, "since_ms": int, "available": bool}
  GET /health   -> {"status": "ok", "camera": bool, "face": bool}

Configuration (environment variables):
  FACE_HOST            bind address           (default 127.0.0.1)
  FACE_PORT            port                   (default 8090)
  FACE_CAMERA_INDEX    webcam index           (default 0)
  FACE_HOLD_MS         keep "present" after the last sighting, smoothing blinks (default 1500)
  FACE_MIN_NEIGHBORS   Haar detector strictness (default 6; higher = fewer false positives)
  FACE_MIN_SIZE        smallest face, pixels (default 90)
  FACE_FRAME_WIDTH     capture width          (default 640)
  FACE_FRAME_HEIGHT    capture height         (default 480)
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import cv2
except ImportError:  # pragma: no cover - operator-facing guidance
    sys.stderr.write(
        "OpenCV is required. Install it with:  python -m pip install opencv-python\n"
    )
    raise SystemExit(1)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


HOST = os.environ.get("FACE_HOST", "127.0.0.1")
PORT = _env_int("FACE_PORT", 8090)
CAMERA_INDEX = _env_int("FACE_CAMERA_INDEX", 0)
HOLD_MS = _env_int("FACE_HOLD_MS", 1500)
MIN_NEIGHBORS = _env_int("FACE_MIN_NEIGHBORS", 6)
MIN_SIZE = _env_int("FACE_MIN_SIZE", 90)
FRAME_WIDTH = _env_int("FACE_FRAME_WIDTH", 640)
FRAME_HEIGHT = _env_int("FACE_FRAME_HEIGHT", 480)

# Shared, tiny state. A lock is overkill for two atomic-ish fields but keeps the reader
# from ever seeing a half-updated snapshot.
_state_lock = threading.Lock()
_state = {
    "count": 0,
    "last_seen": 0.0,  # monotonic seconds
    "camera_open": False,
}

_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)
if _cascade.empty():  # pragma: no cover
    sys.stderr.write("Could not load the Haar frontal-face cascade.\n")
    raise SystemExit(1)


def _open_camera() -> "cv2.VideoCapture":
    """Open the webcam, preferring DirectShow on Windows for faster warm-up."""
    backends = [cv2.CAP_DSHOW, cv2.CAP_ANY] if sys.platform == "win32" else [cv2.CAP_ANY]
    for backend in backends:
        cap = cv2.VideoCapture(CAMERA_INDEX, backend)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
            return cap
        cap.release()
    return cv2.VideoCapture()  # unopened sentinel


def camera_loop() -> None:
    """Read frames forever and keep the shared face state up to date."""
    cap = _open_camera()
    if not cap.isOpened():
        sys.stderr.write(f"Could not open camera index {CAMERA_INDEX}.\n")
        return

    with _state_lock:
        _state["camera_open"] = True
    print(f"Camera {CAMERA_INDEX} open; detecting faces.", flush=True)

    consecutive_failures = 0
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            consecutive_failures += 1
            # A dropped frame is normal; a run of them usually means the device vanished.
            if consecutive_failures > 60:
                sys.stderr.write("Camera stopped returning frames; exiting.\n")
                break
            time.sleep(0.05)
            continue
        consecutive_failures = 0

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        faces = _cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=MIN_NEIGHBORS,
            minSize=(MIN_SIZE, MIN_SIZE),
        )
        count = len(faces)

        with _state_lock:
            _state["count"] = count
            if count > 0:
                _state["last_seen"] = time.monotonic()

    cap.release()


def snapshot() -> dict:
    with _state_lock:
        count = _state["count"]
        last_seen = _state["last_seen"]
        camera_open = _state["camera_open"]

    since = (time.monotonic() - last_seen) if last_seen else None
    held = since is not None and since * 1000.0 <= HOLD_MS
    return {
        "face": held,
        "count": count if held else 0,
        "since_ms": int(since * 1000.0) if since is not None else -1,
        "available": camera_open,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "FacePresence/1.0"

    def _send(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.split("?", 1)[0]
        if path == "/presence":
            self._send(snapshot())
        elif path == "/health":
            snap = snapshot()
            self._send({"status": "ok", "camera": snap["available"], "face": snap["face"]})
        else:
            self._send({"error": "not_found"}, status=404)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, *_args) -> None:  # keep the console quiet
        return


def main() -> int:
    thread = threading.Thread(target=camera_loop, name="camera", daemon=True)
    thread.start()

    server = ThreadingHTTPServer((HOST, PORT), Handler)

    def shutdown(*_args) -> None:
        print("\nStopping face-presence service.", flush=True)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    try:
        signal.signal(signal.SIGTERM, shutdown)
    except (AttributeError, ValueError):
        pass

    print(f"Face-presence service listening on http://{HOST}:{PORT}/presence", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
