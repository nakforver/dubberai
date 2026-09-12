import os
import sys
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
    cfg_value: Optional[float] = 1.0
    inference_timesteps: Optional[int] = 3

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

    uid = uuid.uuid4().hex
    tmp_wav = os.path.join(tempfile.gettempdir(), f"voxcpm_{uid}.wav")
    tmp_mp3 = os.path.join(tempfile.gettempdir(), f"voxcpm_{uid}.mp3")

    cfg_val = req.cfg_value if req.cfg_value is not None else 1.0
    steps = req.inference_timesteps if req.inference_timesteps is not None else 3

    try:
        async with model_lock:
            loop = asyncio.get_event_loop()
            t0 = time.time()
            
            def _run_inference():
                kwargs = {
                    "text": req.text.strip(),
                    "cfg_value": cfg_val,
                    "inference_timesteps": steps,
                }
                if ref_path:
                    kwargs["reference_wav_path"] = ref_path
                
                return m.generate(**kwargs)

            wav = await loop.run_in_executor(None, _run_inference)
            elapsed = time.time() - t0

        sample_rate = getattr(m.tts_model, "sample_rate", 48000)
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
