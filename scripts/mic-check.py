"""Mic-level diagnostic: records 5 s from your default Windows microphone and reports
the peak/RMS on a 16-bit scale. The pipeline needs clearly non-zero numbers.
Run:  python scripts\mic-check.py
"""
import time
import numpy as np
import sounddevice as sd

print("Recording 5 seconds from your default microphone... talk normally.")
print("(It will also play nothing back — this is input-only.)")
samplerate = 16000
device_info = sd.query_devices(kind="input")
print(f"Input device : {device_info['name']}")
print(f"Input channels: {device_info['max_input_channels']}")

rec = sd.rec(int(samplerate * 5), samplerate=samplerate, channels=1, dtype="int16")
sd.wait()
peak = int(np.abs(rec).max())
rms = float((rec.astype(np.float32) ** 2).mean() ** 0.5)
print()
print(f"Peak amplitude : {peak}  (max possible 32767)")
print(f"RMS amplitude  : {rms:.0f}  (should be > 500 for speech)")
print()
if peak < 300:
    print("READING: almost nothing heard — your microphone path is essentially dead.")
    print("Action: check Windows Sound Settings > Input, enable the device, set level > 50%,")
    print("and if it is a laptop array, unmute it in the firmware/BIOS hotkey too (Fn+F10 etc).")
elif rms < 400:
    print("READING: very quiet. The agent will not transcribe this reliably.")
    print("Action: raise the Windows mic level and speak closer to the mic.")
else:
    print("READING: OK — the microphone is picking you up. If the kiosk still fails,")
    print("speak a little louder and closer, and wait for the agent to finish speaking")
    print("before answering (it does not hear you while it is talking, by design).")
