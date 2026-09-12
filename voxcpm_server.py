import os
import sys
import re
import time
import uuid
import base64
import tempfile
import asyncio
import subprocess
import hashlib
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# Optimize PyTorch CPU threading (4 physical cores avoids hyperthreading overhead)
torch.set_num_threads(4)

app = FastAPI(title="VoxCPM2 Voice Cloning Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model = None
model_lock = asyncio.Lock()

def estimate_pitch_hz(audio_data: np.ndarray, sample_rate: int) -> float:
    try:
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
        if len(audio_data) < sample_rate * 0.3:
            return 0.0
        corr = np.correlate(audio_data, audio_data, mode='full')
        corr = corr[len(corr)//2:]
        min_lag = int(sample_rate / 400) # max 400Hz
        max_lag = int(sample_rate / 65)  # min 65Hz
        if max_lag <= min_lag or max_lag >= len(corr):
            return 0.0
        peak_lag = min_lag + int(np.argmax(corr[min_lag:max_lag]))
        if peak_lag <= 0:
            return 0.0
        return float(sample_rate / peak_lag)
    except Exception:
        return 0.0

def get_model():
    global model
    if model is None:
        print("[VoxCPM2] Loading model from pretrained...", flush=True)
        from voxcpm import VoxCPM
        t0 = time.time()
        model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu")
        print(f"[VoxCPM2] Model loaded in {time.time() - t0:.2f}s", flush=True)
    return model

@app.on_event("startup")
async def startup_event():
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, get_model)

@app.get("/health")
async def health():
    return {
        "status": "ready" if model is not None else "loading",
        "device": "cpu",
        "threads": torch.get_num_threads()
    }

class CloneRequest(BaseModel):
    text: str
    reference_wav_path: Optional[str] = None
    reference_audio_base64: Optional[str] = None
    prompt_text: Optional[str] = None
    prompt_wav_path: Optional[str] = None
    gender: Optional[str] = None
    cfg_value: Optional[float] = 2.0
    inference_timesteps: Optional[int] = 6

@app.post("/clone")
async def clone_voice_json(req: CloneRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    m = get_model()
    
    ref_path = req.reference_wav_path

    if req.reference_audio_base64:
        try:
            audio_raw = base64.b64decode(req.reference_audio_base64)
            if len(audio_raw) > 500:
                ref_hash = hashlib.md5(audio_raw).hexdigest()
                cached_ref = os.path.join(tempfile.gettempdir(), f"voxcpm_ref_{ref_hash}.wav")
                if not os.path.exists(cached_ref) or os.path.getsize(cached_ref) == 0:
                    with open(cached_ref, "wb") as f:
                        f.write(audio_raw)
                ref_path = cached_ref
        except Exception as e:
            print(f"[VoxCPM2] Error decoding reference_audio_base64: {e}", flush=True)

    if ref_path and (not os.path.exists(ref_path) or os.path.getsize(ref_path) == 0):
        print(f"[VoxCPM2] Warning: Reference path '{ref_path}' not found, falling back to unconditioned voice", flush=True)
        ref_path = None

    if ref_path and os.path.exists(ref_path):
        try:
            ref_data, ref_sr = sf.read(ref_path)
            ref_max = float(np.abs(ref_data).max()) if len(ref_data) > 0 else 0.0
            if ref_max < 0.02:
                print(f"[VoxCPM2] Warning: Reference audio is near silent (peak={ref_max:.4f}), ignoring reference", flush=True)
                ref_path = None
            else:
                # Protect against wrong-gender reference audio!
                ref_pitch = estimate_pitch_hz(ref_data, ref_sr)
                is_female_req = any(w in str(req.gender).lower() for w in ("female", "woman", "girl", "ស្រី")) if req.gender else False
                is_male_req = any(w in str(req.gender).lower() for w in ("male", "man", "boy", "ប្រុស")) if req.gender else False

                if is_female_req and ref_pitch > 0 and ref_pitch < 160.0:
                    print(f"[VoxCPM2] Rejecting reference audio for female request: detected pitch is {ref_pitch:.1f}Hz (male timbre). Synthesizing with natural AI female voice.", flush=True)
                    ref_path = None
                elif is_male_req and ref_pitch > 165.0:
                    print(f"[VoxCPM2] Rejecting reference audio for male request: detected pitch is {ref_pitch:.1f}Hz (female timbre). Synthesizing with natural AI male voice.", flush=True)
                    ref_path = None
                elif ref_max < 0.7 and ref_path:
                    # Boost reference audio so VoxCPM2 can clearly hear the speaker's vocal formants
                    boosted = ref_data * (0.85 / max(ref_max, 1e-4))
                    sf.write(ref_path, boosted, ref_sr)
                    print(f"[VoxCPM2] Boosted reference audio peak from {ref_max:.3f} to 0.85 (pitch={ref_pitch:.1f}Hz)", flush=True)
        except Exception as e:
            print(f"[VoxCPM2] Error checking/normalizing reference audio: {e}", flush=True)

    uid = uuid.uuid4().hex
    tmp_wav = os.path.join(tempfile.gettempdir(), f"voxcpm_{uid}.wav")
    tmp_mp3 = os.path.join(tempfile.gettempdir(), f"voxcpm_{uid}.mp3")

    text_clean = req.text.strip()

    # Determine gender style guidance if provided
    gender_desc = ""
    if req.gender:
        g = str(req.gender).lower().strip()
        if any(w in g for w in ("female", "woman", "girl", "ស្រី")):
            gender_desc = ", female voice"
        elif any(w in g for w in ("male", "man", "boy", "ប្រុស")):
            gender_desc = ", male voice"

    # For Khmer unicode text, VoxCPM2 requires prompt style prefix '(Khmer language...)'
    # so that the underlying MiniCPM-4 model activates Khmer phonetic synthesis with correct vocal gender.
    is_khmer = bool(re.search(r'[\u1780-\u17ff]', text_clean))
    if not text_clean.startswith("("):
        if is_khmer:
            text_to_synthesize = f"(Khmer language{gender_desc}) {text_clean}"
        elif gender_desc:
            text_to_synthesize = f"({gender_desc.lstrip(', ')}) {text_clean}"
        else:
            text_to_synthesize = text_clean
    else:
        text_to_synthesize = text_clean

    # CFG scale >= 1.8 is critical for faithful text guidance and preventing semantic drift
    cfg_val = req.cfg_value if (req.cfg_value is not None and req.cfg_value >= 1.8) else 2.0
    # 6 timesteps gives sharp phoneme definition on CPU in ~20-25s
    steps = req.inference_timesteps if (req.inference_timesteps is not None and req.inference_timesteps >= 5) else 6

    # Calculate token budget from actual spoken text (excluding style/language parenthesized control prompt)
    spoken_text = re.sub(r'^\([^)]+\)\s*', '', text_to_synthesize)
    max_audio_sec = max(2.5, min(14.0, len(spoken_text) * 0.28 + 1.2))
    max_tokens = int(max_audio_sec * 6.25) + 6

    try:
        async with model_lock:
            loop = asyncio.get_event_loop()
            t0 = time.time()
            
            def _run_inference():
                kwargs = {
                    "text": text_to_synthesize,
                    "cfg_value": cfg_val,
                    "inference_timesteps": steps,
                    "retry_badcase": False,
                    "max_len": max_tokens,
                }
                if ref_path:
                    kwargs["reference_wav_path"] = ref_path
                
                return m.generate(**kwargs)

            wav = await loop.run_in_executor(None, _run_inference)
            elapsed = time.time() - t0

        sample_rate = getattr(m.tts_model, "sample_rate", 48000)
        
        # Trim leading and trailing silence for clean playback
        if len(wav) > 0:
            abs_wav = np.abs(wav)
            non_silent = np.where(abs_wav > 0.015)[0]
            if len(non_silent) > 0:
                s_idx = max(0, non_silent[0] - int(sample_rate * 0.04))
                e_idx = min(len(wav), non_silent[-1] + int(sample_rate * 0.08))
                wav = wav[s_idx:e_idx]

        # Normalize output speech to peak 0.89 (-1.0 dB) so speech is loud, clear, and never quiet or hissy
        max_amp = float(np.abs(wav).max()) if len(wav) > 0 else 0.0
        if max_amp > 1e-4:
            wav = wav * (0.89 / max_amp)

        duration = len(wav) / sample_rate
        print(f"[VoxCPM2] Generated {duration:.2f}s audio for text '{req.text[:30]}...' in {elapsed:.2f}s (ref: {bool(ref_path)}, steps={steps}, cfg={cfg_val})", flush=True)

        sf.write(tmp_wav, wav, sample_rate)
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp_wav, "-c:a", "libmp3lame", "-b:a", "192k", tmp_mp3],
            check=False
        )
        
        if os.path.exists(tmp_mp3) and os.path.getsize(tmp_mp3) > 0:
            with open(tmp_mp3, "rb") as f:
                audio_bytes = f.read()
            media_type = "audio/mpeg"
        else:
            with open(tmp_wav, "rb") as f:
                audio_bytes = f.read()
            media_type = "audio/wav"

    finally:
        for p in (tmp_wav, tmp_mp3):
            if p and os.path.exists(p):
                try: os.remove(p)
                except Exception: pass

    return Response(
        content=audio_bytes,
        media_type=media_type,
        headers={
            "Content-Type": media_type,
            "X-TTS-Duration": f"{duration:.3f}",
            "Access-Control-Expose-Headers": "X-TTS-Duration"
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("voxcpm_server:app", host="0.0.0.0", port=5005, log_level="info")
