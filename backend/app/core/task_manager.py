import asyncio
import json
import logging
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


class TaskStep(str, Enum):
    QUEUED = "queued"
    DETECTING = "detecting"
    RENDERING_OVERLAY = "rendering_overlay"
    TRACKS_READY = "tracks_ready"
    CONVERTING = "converting"
    BVH_READY = "bvh_ready"
    ERROR = "error"


@dataclass
class TaskState:
    task_id: str
    status: TaskStep = TaskStep.QUEUED
    progress: float = 0.0
    message: str = ""
    video_path: str | None = None
    start_frame: int = 0
    end_frame: int = -1
    frame_step: int = 1
    pkl_path: str | None = None
    overlay_path: str | None = None
    bvh_path: str | None = None
    native_fps: float = 30.0
    tracks: list[dict] | None = None
    total_frames: int = 0
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.now)
    client_id: str = ""
    share_token: str = ""
    file_name: str = ""
    detect_started_at: datetime | None = None
    detect_finished_at: datetime | None = None
    convert_started_at: datetime | None = None
    convert_finished_at: datetime | None = None
    clip_start_time: float = 0.0
    clip_end_time: float = 0.0
    converted_track_id: int | None = None
    enqueued_at: datetime | None = None

    def to_status_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
        }

    def to_persist_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "client_id": self.client_id,
            "share_token": self.share_token,
            "file_name": self.file_name,
            "status": self.status.value,
            "video_path": self.video_path,
            "overlay_path": self.overlay_path,
            "bvh_path": self.bvh_path,
            "pkl_path": self.pkl_path,
            "native_fps": self.native_fps,
            "tracks": self.tracks,
            "total_frames": self.total_frames,
            "start_frame": self.start_frame,
            "end_frame": self.end_frame,
            "frame_step": self.frame_step,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "detect_started_at": self.detect_started_at.isoformat() if self.detect_started_at else None,
            "detect_finished_at": self.detect_finished_at.isoformat() if self.detect_finished_at else None,
            "convert_started_at": self.convert_started_at.isoformat() if self.convert_started_at else None,
            "convert_finished_at": self.convert_finished_at.isoformat() if self.convert_finished_at else None,
            "clip_start_time": self.clip_start_time,
            "clip_end_time": self.clip_end_time,
            "converted_track_id": self.converted_track_id,
            "enqueued_at": self.enqueued_at.isoformat() if self.enqueued_at else None,
        }

    @classmethod
    def from_persist_dict(cls, d: dict) -> "TaskState":
        def _parse_dt(key: str) -> datetime | None:
            v = d.get(key)
            return datetime.fromisoformat(v) if v else None

        return cls(
            task_id=d["task_id"],
            status=TaskStep(d.get("status", "error")),
            video_path=d.get("video_path"),
            start_frame=d.get("start_frame", 0),
            end_frame=d.get("end_frame", -1),
            frame_step=d.get("frame_step", 1),
            pkl_path=d.get("pkl_path"),
            overlay_path=d.get("overlay_path"),
            bvh_path=d.get("bvh_path"),
            native_fps=d.get("native_fps", 30.0),
            tracks=d.get("tracks"),
            total_frames=d.get("total_frames", 0),
            error=d.get("error"),
            created_at=datetime.fromisoformat(d["created_at"]),
            client_id=d.get("client_id", ""),
            share_token=d.get("share_token", ""),
            file_name=d.get("file_name", ""),
            detect_started_at=_parse_dt("detect_started_at"),
            detect_finished_at=_parse_dt("detect_finished_at"),
            convert_started_at=_parse_dt("convert_started_at"),
            convert_finished_at=_parse_dt("convert_finished_at"),
            clip_start_time=d.get("clip_start_time", 0.0),
            clip_end_time=d.get("clip_end_time", 0.0),
            converted_track_id=d.get("converted_track_id"),
            enqueued_at=_parse_dt("enqueued_at"),
        )


class TaskManager:
    def __init__(self, history_dir: Path | None = None) -> None:
        self.tasks: dict[str, TaskState] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.subscribers: dict[str, list[Any]] = {}
        self._lock = asyncio.Lock()
        self.history_dir = history_dir
        self._share_index: dict[str, str] = {}

    def create_task(self, video_path: str) -> str:
        task_id = uuid.uuid4().hex[:8]
        self.tasks[task_id] = TaskState(task_id=task_id, video_path=video_path)
        return task_id

    def get(self, task_id: str) -> TaskState | None:
        return self.tasks.get(task_id)

    def get_by_share_token(self, token: str) -> TaskState | None:
        task_id = self._share_index.get(token)
        if task_id is None:
            return None
        return self.tasks.get(task_id)

    async def enqueue(self, task_id: str) -> None:
        task = self.tasks.get(task_id)
        if task is not None:
            task.enqueued_at = datetime.now()
        await self.queue.put(task_id)

    async def update_progress(
        self,
        task_id: str,
        status: TaskStep,
        progress: float,
        message: str = "",
        error: str | None = None,
    ) -> None:
        task = self.tasks.get(task_id)
        if task is None:
            return
        task.status = status
        task.progress = progress
        task.message = message
        if error is not None:
            task.error = error
        await self._notify(task_id)

    async def subscribe(self, task_id: str, ws: Any) -> None:
        self.subscribers.setdefault(task_id, []).append(ws)

    async def unsubscribe(self, task_id: str, ws: Any) -> None:
        if task_id in self.subscribers and ws in self.subscribers[task_id]:
            self.subscribers[task_id].remove(ws)

    async def _notify(self, task_id: str) -> None:
        task = self.tasks[task_id]
        msg = {
            "type": "progress",
            "task_id": task_id,
            "step": task.status.value,
            "progress": task.progress,
            "message": task.message,
            "error": task.error,
        }
        dead = []
        for ws in self.subscribers.get(task_id, []):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.subscribers[task_id].remove(ws)

    def save_history(self, task_id: str) -> None:
        if self.history_dir is None:
            return
        task = self.tasks.get(task_id)
        if task is None:
            return
        self.history_dir.mkdir(parents=True, exist_ok=True)
        dest = self.history_dir / f"{task_id}.json"
        tmp = dest.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(task.to_persist_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(dest)
        if task.share_token:
            self._share_index[task.share_token] = task_id

    def load_history(self, max_age_hours: float = 168) -> int:
        if self.history_dir is None or not self.history_dir.exists():
            return 0
        now = datetime.now()
        loaded = 0
        for json_path in self.history_dir.glob("*.json"):
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
                task = TaskState.from_persist_dict(data)
            except Exception:
                log.warning("skipping corrupt history file: %s", json_path)
                continue
            age_hours = (now - task.created_at).total_seconds() / 3600
            if age_hours > max_age_hours:
                self._cleanup_task_files(task, json_path)
                continue
            if task.task_id in self.tasks:
                continue
            self.tasks[task.task_id] = task
            if task.share_token:
                self._share_index[task.share_token] = task.task_id
            loaded += 1
        log.info("loaded %d tasks from history", loaded)
        return loaded

    def delete_task(self, task_id: str) -> bool:
        task = self.tasks.pop(task_id, None)
        if task is None:
            return False
        if task.share_token:
            self._share_index.pop(task.share_token, None)
        self.subscribers.pop(task_id, None)
        self._cleanup_task_files(task)
        if self.history_dir:
            (self.history_dir / f"{task_id}.json").unlink(missing_ok=True)
        return True

    def _cleanup_task_files(self, task: TaskState, json_path: Path | None = None) -> None:
        for path_attr in ("video_path", "pkl_path", "overlay_path", "bvh_path"):
            p = getattr(task, path_attr, None)
            if p:
                Path(p).unlink(missing_ok=True)
        if task.pkl_path:
            work_dir = Path(task.pkl_path).parent.parent
            if work_dir.is_dir() and work_dir.name == task.task_id:
                shutil.rmtree(work_dir, ignore_errors=True)
        if json_path:
            json_path.unlink(missing_ok=True)

    def cleanup_old_tasks(self, max_age_hours: float = 168) -> list[str]:
        now = datetime.now()
        expired = [
            tid
            for tid, t in self.tasks.items()
            if (now - t.created_at).total_seconds() > max_age_hours * 3600
        ]
        for tid in expired:
            self.delete_task(tid)
        return expired
