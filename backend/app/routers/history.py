from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request

from app.models.schemas import HistoryItem, SharedTaskResponse, TrackInfo

router = APIRouter()


@router.get("/history", response_model=list[HistoryItem])
async def list_history(
    request: Request,
    x_client_id: str = Header(""),
) -> list[HistoryItem]:
    if not x_client_id:
        return []
    tm = request.app.state.task_manager
    items = [
        t for t in tm.tasks.values()
        if t.client_id == x_client_id
    ]
    items.sort(key=lambda t: t.created_at, reverse=True)
    return [
        HistoryItem(
            task_id=t.task_id,
            share_token=t.share_token,
            file_name=t.file_name,
            status=t.status.value,
            created_at=t.created_at.isoformat(),
            has_bvh=bool(t.bvh_path and Path(t.bvh_path).exists()),
            has_overlay=bool(t.overlay_path and Path(t.overlay_path).exists()),
            error=t.error,
        )
        for t in items
    ]


@router.get("/r/{share_token}", response_model=SharedTaskResponse)
async def get_shared_task(
    request: Request,
    share_token: str,
) -> SharedTaskResponse:
    tm = request.app.state.task_manager
    task = tm.get_by_share_token(share_token)
    if task is None:
        raise HTTPException(404, "not found")
    tracks = [TrackInfo(**t) for t in task.tracks] if task.tracks else None
    return SharedTaskResponse(
        task_id=task.task_id,
        file_name=task.file_name,
        status=task.status.value,
        created_at=task.created_at.isoformat(),
        has_bvh=bool(task.bvh_path and Path(task.bvh_path).exists()),
        has_overlay=bool(task.overlay_path and Path(task.overlay_path).exists()),
        has_video=bool(task.video_path and Path(task.video_path).exists()),
        tracks=tracks,
        detection_fps=int(round(task.native_fps)) if task.tracks else None,
        total_frames=task.total_frames if task.tracks else None,
    )
