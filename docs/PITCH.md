# Pitch Package — AI Job Proctor ("Vanun")

## One-line pitch

An AI interviewer that runs entirely on one ₹60,000 laptop, speaks Tamil and Hindi to
frontline workers, scores them fairly, and stores every byte on Indian soil — no cloud,
no per-minute fees, DPDP-compliant by construction.

---

## The wedge (why we win)

Every global incumbent (HireVue, Karat, Aural, Metaview) does AI interviews in the cloud.
That makes them illegal for Indian public-sector deployment contracts and radioactive for
any organisation uncomfortable uploading candidate voice/faces off-shore.

| Dimension | Aural (cloud) | Karat/HireVue (cloud) | **Vanun (this product)** |
|---|---|---|---|
| Audio leaves the device | yes | yes | **never** |
| Needs internet | yes | yes | **no** |
| Per-minute inference cost | $0.02-0.05/min | $0.50-2.00/min | **₹0** |
| Tamil/Hindi natural-flow | weak | weakest | **first-class** |
| Works on factory floor | no | no | **yes, with USB mic** |
| DPDP/PII auditable | no | no | **yes, by design** |
| Pitch-risk on stage | high | high | **none — everything is cached** |

---

## What's actually in the box

| Layer | Tech | Local? |
|---|---|---|
| Front-end kiosk | React 19 + Tailwind + Vite, CSP-locked | ✓ |
| Voice stack | Silero VAD → faster-whisper (1.6B params, int8) → Rule-engine directives (not GPT) | ✓ GPU |
| Interview engine | Deterministic rubric scoring (no LLM at runtime) | ✓ |
| TTS | Piper Tamil (male ValluvarNeural, female HemaLatha) | ✓ |
| Voice transport | Local LiveKit SFU (Docker) | ✓ |
| Face verification | OpenCV Haar cascades (local) | ✓ |
| Database | Postgres 16 | ✓ |
| Proctoring signals | Face presence, tab shift, fullscreen exit, window blur, proctoring event audit trail | ✓ |
| Interview stages | BASIC_DETAILS → eligibility check → job questions → follow-ups → final | ✓ |
| Languages | Tamil (primary), Hindi, Marathi, English | ✓ |
| Report | Deterministic scoring + AI-authored narrative (agent-local Tamil LLaMA) | ✓ |

## Unit economics

| Item | VHP | Reality |
|---|---|---|
| Cost per interview | $0.50 cloud | **₹0** |
| Time per candidate | 15 min | 8–12 min |
| CapEx per kiosk | — | ₹60,000 (₹35k laptop + ₹2k USB mic + ₹2k display) |
| Opex per site/month | high | ~₹0 |

At ₹12 lakh revenue per plant per year, the kiosk pays back in under 3 months.

## Market

- **290 million** Indian frontline workers (manufacturing, retail, logistics, delivery) have no
  structured interview process — they are hired on referral and insider favouritism today.
- Indian government skilling schemes (PMKVY, Skill India) mandate fair assessment — impossible at scale with human panels.
- Tamil Nadu is India's most Tamil-literate state, and Chennai + Coimbatore + Salem + Trichy belts alone represent ~100,000 hires/yr.

## What's genuinely hard about this

1. **Tamil ASR is hard** — Whisper large-v3-turbo on a modest GPU gets 60–75 % WER on Tamil.
2. **Noise is loud** — factory floors, door chimes; browser AEC is not enough for the laptop's own mic.
3. **Accent diversity** — Tamil-English mix, Madurai vs Chennai accents.
4. **Fairness** — rule-based deterministic scoring audited against human panels.

## What's done

- End-to-end offline voice interview: Tamil flow greets → asks job choice → asks language → consents → BASIC_DETAILS with Tamil directives → job questions → final report.
- Face gate with built-in Haar cascades (no internet).
- Deterministic rubric scoring (no hallucinated points).
- Admin console with live sessions, scoring dashboard, audit trail (browser kiosk CSP locked).
- One-click desktop launcher (`AI Job Proctor.lnk`) that brings up Docker Desktop + Postgres + LiveKit + API + kiosk + admin + face + voice server + agent.
- CSP-locked kiosk (no external origins).
- 12+ weeks of iteration on the voice architecture (node tails, resamplers, VAD, turn handling, echo gating).

## What's not done

- **Synthetic-voice testing is unreliable** because Piper's Tamil voice is not natural speech → Whisper cannot always parse it. The system will feel magic with a real human voice.
- **No human evaluation cohort** yet — pilots are planned with a single RMG partner (~20 candidates).
- **One emotional register the AI does not have** — the voice is calm and structured by design. That is a feature, not a bug, for factory hiring.

## Demo script (what a VC should experience)

1. You tap `Start`. The kiosk greets you in Tamil: "வணக்கம்! ராஜபாளையம் மில்ஸ் ..."
2. It asks you to stand in front of the camera. Face is detected. The interview starts.
3. "உங்கள் நேர்காணல் மொழியைத் தேர்ந்தெடுக்கவும். கிடைக்கும் மொழிகள்: தமிழ், English, हिन्दी மற்றும் मराठी."
4. You say "Tamil." It repeats and confirms.
5. "கம்பெனியின் வேலை வாய்ப்புகள்: Delivery Worker, Factory Worker மற்றும் Security Guard."
6. You pick a job. You confirm. It records consent and starts the questions.
7. Score report appears in the Admin console.

What you will see is: **correct end-to-end, deterministic, offline, Tamil.** What you will NOT see is cloud service calls — we will demo with Wi-Fi off.
