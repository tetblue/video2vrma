from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from app.core.task_manager import TaskStep
from app.models.schemas import (
    ConvertRequest,
    ConvertResponse,
    TaskStatus,
    TrackInfo,
    TracksResponse,
)

router = APIRouter()


def _get_task_or_404(request: Request, task_id: str):
    task = request.app.state.task_manager.get(task_id)
    if task is None:
        raise HTTPException(404, f"task {task_id} not found")
    return task


@router.get("/tasks/{task_id}/status", response_model=TaskStatus)
async def get_status(request: Request, task_id: str) -> TaskStatus:
    task = _get_task_or_404(request, task_id)
    return TaskStatus(**task.to_status_dict())


@router.get("/tasks/{task_id}/tracks", response_model=TracksResponse)
async def get_tracks(request: Request, task_id: str) -> TracksResponse:
    task = _get_task_or_404(request, task_id)
    if task.tracks is None:
        raise HTTPException(409, f"tracks not ready (status={task.status.value})")
    return TracksResponse(
        task_id=task_id,
        tracks=[TrackInfo(**t) for t in task.tracks],
        detection_fps=int(round(task.native_fps)),
        total_frames=task.total_frames,
    )


@router.post("/tasks/{task_id}/convert", response_model=ConvertResponse)
async def post_convert(
    request: Request, task_id: str, body: ConvertRequest
) -> ConvertResponse:
    task = _get_task_or_404(request, task_id)
    if task.status not in (TaskStep.TRACKS_READY, TaskStep.BVH_READY):
        raise HTTPException(409, f"task not ready for convert (status={task.status.value})")

    worker = request.app.state.gpu_worker
    try:
        await worker.process_convert(task_id, body.track_id, body.fps, body.smoothing)
    except KeyError:
        raise HTTPException(404, f"task {task_id} disappeared")
    except Exception as exc:
        raise HTTPException(500, str(exc))
    return ConvertResponse(task_id=task_id, status=task.status.value)


@router.get("/tasks/{task_id}/download/bvh")
async def download_bvh(request: Request, task_id: str) -> FileResponse:
    task = _get_task_or_404(request, task_id)
    if not task.bvh_path or not Path(task.bvh_path).exists():
        raise HTTPException(404, "bvh not ready")
    return FileResponse(
        task.bvh_path,
        media_type="application/octet-stream",
        filename=f"{task_id}.bvh",
    )


@router.get("/tasks/{task_id}/video")
async def serve_video(request: Request, task_id: str) -> FileResponse:
    task = _get_task_or_404(request, task_id)
    if not task.video_path or not Path(task.video_path).exists():
        raise HTTPException(404, "video not found")
    return FileResponse(task.video_path, media_type="video/mp4")


@router.get("/tasks/{task_id}/overlay")
async def serve_overlay(request: Request, task_id: str) -> FileResponse:
    task = _get_task_or_404(request, task_id)
    if not task.overlay_path or not Path(task.overlay_path).exists():
        raise HTTPException(404, "overlay not ready")
    return FileResponse(task.overlay_path, media_type="video/mp4")


@router.websocket("/ws/tasks/{task_id}")
async def ws_task(ws: WebSocket, task_id: str) -> None:
    await ws.accept()
    task_manager = ws.app.state.task_manager
    task = task_manager.get(task_id)
    if task is None:
        await ws.send_json({"type": "error", "error": "task not found"})
        await ws.close()
        return

    await task_manager.subscribe(task_id, ws)
    await ws.send_json({"type": "snapshot", **task.to_status_dict()})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await task_manager.unsubscribe(task_id, ws)
