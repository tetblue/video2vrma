import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any


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
    pkl_path: str | None = None
    overlay_path: str | None = None
    bvh_path: str | None = None
    tracks: list[dict] | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.now)

    def to_status_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "error": self.error,
        }


class TaskManager:
    def __init__(self) -> None:
        self.tasks: dict[str, TaskState] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.subscribers: dict[str, list[Any]] = {}
        self._lock = asyncio.Lock()

    def create_task(self, video_path: str) -> str:
        task_id = uuid.uuid4().hex[:8]
        self.tasks[task_id] = TaskState(task_id=task_id, video_path=video_path)
        return task_id

    def get(self, task_id: str) -> TaskState | None:
        return self.tasks.get(task_id)

    async def enqueue(self, task_id: str) -> None:
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

    def cleanup_old_tasks(self, max_age_hours: float = 24) -> list[str]:
        now = datetime.now()
        expired = [
            tid
            for tid, t in self.tasks.items()
            if (now - t.created_at).total_seconds() > max_age_hours * 3600
        ]
        for tid in expired:
            task = self.tasks.pop(tid)
            for path_attr in ("video_path", "pkl_path", "overlay_path", "bvh_path"):
                p = getattr(task, path_attr, None)
                if p:
                    Path(p).unlink(missing_ok=True)
            self.subscribers.pop(tid, None)
        return expired
