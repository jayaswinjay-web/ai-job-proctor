# Demo Setup — Vanun AI Job Proctor

## What the demo kit in a real pitch looks like

One laptop — a ₹35,000 Windows 11 laptop with 16 GB RAM and a 4 GB NVIDIA GPU (RTX 2050 or better).

Peripherals:
- **USB microphone with cardioid pattern** (₹1,500–₹3,000 range: Samson Q2U, Behringer XM1800S, or even a ₹900 phone-tripod lav). **This is non-optional.** Laptop mic arrays are echo-cancellation nightmares; AEC turns the candidate signal into silence and Whisper reports hallucinations.
- Monitor coupon (the kiosk screen runs full-screen Chrome at localhost:5173).
- A Costa Desktop Box (not on-screen) to hold the laptop open behind the kiosk.

## What the demo does NOT try to prove

- It does not need internet; a demo with Wi-Fi switched OFF is more persuasive.
- It does not need headphones — a cardioid mic in front of the candidate and the kiosk's speakers at low volume is the realistic deployment.

## What failed worst during testing, and why

| Symptom | Root cause | Fix |
|---|---|---|
| "It didn't understand me" | Laptop mic array + browser AEC crushed near-field voice | USB cardioid mic |
| STT garbage to Whisper small/tiny | 48 kHz mic feed → Whisper needs 16 kHz | livekit Wave re-sampling (fixed) |
| "It stopped responding after I spoke" | Free-chat LLM-generated reply never ran | Deterministic rubric (rules, no LLM) |
| Interview always said "didn't catch that" | ASR too weak on Tamil utterances through synthetic voices | Larger model (faster-whisper-large-v3-turbo int8, 1.6 GB) |
| Greeting heard but candidate answer ignored | VAD silence detection threshold | `min_silence_duration=0.55` w/ silero; candidates must finish sentences |

## What to do before every demo

1. Double-click the AI Job Proctor icon on the desktop. Everything starts in ~90 s (Docker Desktop starts, local LiveKit Server, Postgres, API, kiosk, agent, face gate, GPU voice server).
2. Verify `http://localhost:5173/` responds.
3. Stand in front of the camera. The face gate arms.
4. Listen to the greeting in Tamil, answer in 5–8-word Tamil sentences (single-word answers may be misheard).
5. If you want to demo in English, simply say "English" when asked.

## DEMO_WIFI_OFF test (do this at least once)

Turn off Wi-Fi on the demo machine and repeat the full flow. Everything must work. That is the product's headline feature. The first time it crashes offline is the last time you pitch it.

## The sound check that matters

Mic placement matters more than any software fix. Place the USB mic 20–40 cm from the candidate's mouth, slightly to the side (not in the direct line of breath). Set laptop speaker volume to 30–40% and NOT louder — the mic and speakers should not be fighting.
