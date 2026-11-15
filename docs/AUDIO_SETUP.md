# Audio Setup — AI Job Proctor on the factory floor

## Why a desk mic and not a laptop kiosk?

The laptops slated for the pitch ship with an array microphone on the chassis. Measured on one of
them (`scripts/mic-check.py` → `sounddevice`):

| State | Peak | RMS |
|---|---|---|
| Room, no one speaking (fan + traffic) | 1662 / 32767 | 56 |
| Usable ambient speech target | — | > 1000 |

Chrome's echo canceller covers the case where the same laptop both speaks and records by
reducing what it thinks is echo (i.e. the far end = us, the near end = the candidate). When
the laptop's own speakers are blasting at full volume, its own echo crush goes to ~0 dB of
gain on the candidate. **This is physics, not code.** (Airdopes and ICE-tablets have their
own sealed acoustic paths; factory laptops do not.)

## The ambient solution that works without headphones

| Item | Cost | Purpose |
|---|---|---|
| USB conference mic, omnidirectional (Anker PowerConf S3 / Samson Q2U / any ₹500–1,500 Amazon refurbished microphone) | ₹1,500–3,000 | Capture candidate at 30 cm at room gain |
| Small USB speaker (Portronics / Redgear / competing unit) | ₹500–1,200 | Play agent voice at low volume in a different physical location |

Mounting:
- USB mic on a desk-stand, 30–45 cm in front of the candidate
- USB speaker or small Bluetooth speaker > 1.2 m away from the mic

Configuration (already in code):
- Agent TTS plays at **volume = 0.55** by default (was 1.0) — `local-livekit-agent.py` with `volume=0.55`
- Intro video plays at **volume = 0.35** — `WelcomeScreen.tsx`
- Kiosk Chrome is launched with `echoCancellation=true` + `autoGainControl=true` + `noiseSuppression=true` (`apps/kiosk/src/lib/voice.ts`)

## The exact "kiosk" scenario the pitch should show

1. Laptop on a table, facing the candidate
2. USB mic standing on the desk, 30 cm from candidate
3. USB speaker toward the candidate, in a different spot than the mic
4. HDMI UI fullscreen at `http://localhost:5173`
5. Candidate speaks Tamil; agent listens and responds
6. **No headphones. No headset. This is the product.**

If you cannot provide the USB mic, the demo is not a demo; it is a private listening session. Keep that as the pitch's honest story: "the ambient kiosk runs with a ₹1,000 box of peripherals — that's how factories near you already run video check-in."

## What is already in the repository that makes this real

- `scripts/mic-check.py` — 5-second proof that the mic is working (commit 618ac94)
- `scripts/local-livekit-agent.py` — wired 48 kHz → 16 kHz resampling pipeline for STT
- `scripts/local-voice-server.py` — volume setting for the microphone array
- `apps/kiosk/.../VoiceScreen.tsx` — obvious "speak now" vs "waiting for AI" states
- `apps/kiosk/.../WelcomeScreen.tsx` — tap anywhere to skip intro; 12 s fallback
- `apps/kiosk/src/lib/voice.ts` — `autoGainControl:true` + `noiseSuppression:true` on the mic
- `docs/DEMO.md` — step-by-step pitch floor wiring

## Finale

The right call is not to pretend ambient-without-hardware works. It doesn't on this machine,
and it won't on the next one. What ships is: a local AI voice loop, strong turn-taking,
clear ambient limits, a ₹1,500 fix, and a ₹60,000 laptop — the pitch is an honest kiosk story,
not a fictional one.
