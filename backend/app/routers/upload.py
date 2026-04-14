import math
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile

from app.config import ALLOWED_FRAME_STEPS, MAX_UPLOAD_BYTES
from app.models.schemas import UploadResponse

router = APIRouter()

ALLOWED_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

# Phase 6c：串流寫檔時每塊的大小（1 MB），過大回 413
_CHUNK_SIZE = 1024 * 1024


def _probe_fps_and_duration(path: Path) -> tuple[float, float]:
    import cv2

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    cap.release()
    fps = fps if fps > 0 else 30.0
    duration = frames / fps if fps > 0 and frames > 0 else 0.0
    return fps, duration


@router.post("/upload", response_model=UploadResponse)
async def upload(
    request: Request,
    file: UploadFile = File(...),
    start_time: Optional[float] = Form(None),
    end_time: Optional[float] = Form(None),
    frame_step: Optional[int] = Form(None),
    x_client_id: str = Header(""),
    content_length: Optional[int] = Header(None),
) -> UploadResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"unsupported file type: {suffix or '<none>'}")

    # Phase 6c.2：Content-Length 預檢（可被偽造，之後寫檔時再次累計）
    if content_length is not None and content_length > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            f"檔案超過上限 {MAX_UPLOAD_BYTES // (1024 * 1024)} MB (Content-Length={content_length})",
        )

    # Phase 6c.4：frame_step 白名單檢查（預設 None → 1；非白名單 → 400）
    effective_frame_step = 1 if frame_step is None else int(frame_step)
    if effective_frame_step not in ALLOWED_FRAME_STEPS:
        raise HTTPException(
            400,
            f"frame_step 必須為 {ALLOWED_FRAME_STEPS} 其中之一 (got {effective_frame_step})",
        )

    # Phase 6c.3：start/end 時間順序檢查（上界需讀到 fps 後才能判定）
    if start_time is not None and start_time < 0:
        raise HTTPException(400, "start_time 不可為負值")
    if end_time is not None and end_time < 0:
        raise HTTPException(400, "end_time 不可為負值")
    if (
        start_time is not None
        and end_time is not None
        and start_time > 0
        and end_time > 0
        and end_time <= start_time
    ):
        raise HTTPException(400, "end_time 必須大於 start_time")

    upload_dir: Path = request.app.state.upload_dir
    upload_dir.mkdir(parents=True, exist_ok=True)

    task_manager = request.app.state.task_manager
    task_id = task_manager.create_task(video_path="")
    dest = upload_dir / f"{task_id}{suffix}"

    # Phase 6c.2：串流寫檔，即時累計 bytes 防 Content-Length 偽造
    written = 0
    try:
        with dest.open("wb") as f:
            while True:
                chunk = await file.read(_CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    f.close()
                    dest.unlink(missing_ok=True)
                    # 清掉已建立的 task（避免殘留）
                    task_manager.tasks.pop(task_id, None)
                    raise HTTPException(
                        413,
                        f"檔案超過上限 {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        task_manager.tasks.pop(task_id, None)
        raise

    task = task_manager.tasks[task_id]
    task.video_path = str(dest)
    task.client_id = x_client_id or uuid.uuid4().hex
    task.share_token = uuid.uuid4().hex[:12]
    task.file_name = file.filename or "unknown"

    fps, duration = _probe_fps_and_duration(dest)
    task.native_fps = fps

    # Phase 6c.3：end_time 上界檢查（需要 fps 才能判定）
    if (
        end_time is not None
        and end_time > 0
        and duration > 0
        and end_time > duration + 1e-3
    ):
        dest.unlink(missing_ok=True)
        task_manager.tasks.pop(task_id, None)
        raise HTTPException(
            400,
            f"end_time ({end_time}s) 超過影片長度 ({duration:.2f}s)",
        )

    start_frame = 0
    end_frame = -1
    if start_time is not None or end_time is not None:
        if start_time is not None and start_time > 0:
            start_frame = math.floor(start_time * fps)
        if end_time is not None and end_time > 0:
            end_frame = math.ceil(end_time * fps)

    task.start_frame = start_frame
    task.end_frame = end_frame
    task.frame_step = effective_frame_step
    task.clip_start_time = float(start_time) if start_time and start_time > 0 else 0.0
    task.clip_end_time = float(end_time) if end_time and end_time > 0 else 0.0

    task_manager.save_history(task_id)
    await task_manager.enqueue(task_id)
    return UploadResponse(task_id=task_id, share_token=task.share_token)
