import math
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile

from app.models.schemas import UploadResponse

router = APIRouter()

ALLOWED_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def _probe_fps(path: Path) -> float:
    import cv2

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    return fps if fps > 0 else 30.0


@router.post("/upload", response_model=UploadResponse)
async def upload(
    request: Request,
    file: UploadFile = File(...),
    start_time: Optional[float] = Form(None),
    end_time: Optional[float] = Form(None),
    x_client_id: str = Header(""),
) -> UploadResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"unsupported file type: {suffix or '<none>'}")

    upload_dir: Path = request.app.state.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)

    task_manager = request.app.state.task_manager
    task_id = task_manager.create_task(video_path="")
    dest = upload_dir / f"{task_id}{suffix}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    task = task_manager.tasks[task_id]
    task.video_path = str(dest)
    task.client_id = x_client_id or uuid.uuid4().hex
    task.share_token = uuid.uuid4().hex[:12]
    task.file_name = file.filename or "unknown"

    fps = _probe_fps(dest)
    task.native_fps = fps

    start_frame = 0
    end_frame = -1
    if start_time is not None or end_time is not None:
        if start_time is not None and start_time > 0:
            start_frame = math.floor(start_time * fps)
        if end_time is not None and end_time > 0:
            end_frame = math.ceil(end_time * fps)

    task.start_frame = start_frame
    task.end_frame = end_frame

    task_manager.save_history(task_id)
    await task_manager.enqueue(task_id)
    return UploadResponse(task_id=task_id, share_token=task.share_token)
