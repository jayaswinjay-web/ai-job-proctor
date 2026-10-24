# Model / quantization notes

- Verify exact model names, versions, licenses before pinning (prompt section 3).
- LLM serving: vLLM (GPU) + llama.cpp (CPU/edge fallback), 4-bit quant (AWQ/GPTQ/GGUF).
- STT: Whisper-family streaming model fine-tuned for Indian English / Indic.
- TTS: streaming-capable open TTS fine-tuned on licensed Indian voice data.

Local quantized serving cannot be exercised without a GPU — see docs/PLAN.md Phase 2.
