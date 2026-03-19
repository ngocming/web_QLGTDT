from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .processor import NoParkZoneEngine, analyse_video_file

ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT_DIR / "configs" / "config.yaml"
UPLOADS_DIR = ROOT_DIR / "outputs" / "uploads"
PROCESSED_DIR = ROOT_DIR / "outputs" / "processed"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="No Park Zone API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/outputs", StaticFiles(directory=str(ROOT_DIR / "outputs")), name="outputs")

live_engine = NoParkZoneEngine(CONFIG_PATH)


class FramePayload(BaseModel):
    frame_b64: str


@app.get("/api/no-park/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "no-park-zone", "config": str(CONFIG_PATH)}


@app.post("/api/no-park/live/reset")
def reset_live() -> Dict[str, Any]:
    live_engine.reset()
    return {"ok": True}


@app.post("/api/no-park/live/frame")
def analyse_live_frame(payload: FramePayload):
    try:
        return live_engine.process_frame_b64(payload.frame_b64)
    except Exception as exc:  # pragma: no cover - runtime safety
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/no-park/video")
async def analyse_video(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Khong co ten file.")

    safe_name = Path(file.filename).name
    upload_path = UPLOADS_DIR / safe_name
    processed_path = PROCESSED_DIR / f"processed_{safe_name}"

    try:
        with upload_path.open("wb") as target:
            shutil.copyfileobj(file.file, target)

        result = analyse_video_file(upload_path, processed_path, CONFIG_PATH)
        return JSONResponse(
            {
                "success": True,
                "filename": safe_name,
                "processed_video_url": f"/outputs/processed/{processed_path.name}",
                "summary": result,
            }
        )
    except Exception as exc:  # pragma: no cover - runtime safety
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        await file.close()
