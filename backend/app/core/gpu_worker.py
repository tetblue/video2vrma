import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Callable

from .task_manager import TaskManager, TaskStep

log = logging.getLogger(__name__)


class GPUWorker:
    """單線程 GPU worker：detect 走 queue，convert 由路由直接呼叫。

    pipeline_module 預期提供 step1_detect / step2_convert，注入是為了測試
    時可以塞 stub。
    """

    def __init__(
        self,
        task_manager: TaskManager,
        pipeline_module,
        work_dir: Path,
    ) -> None:
        self.task_manager = task_manager
        self.pipeline = pipeline_module
        self.work_dir = work_dir
        self.executor = ThreadPoolExecutor(max_workers=1)
        self._loop_task: asyncio.Task | None = None

    async def start(self) -> None:
        self._loop_task = asyncio.create_task(self._process_loop())

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
        self.executor.shutdown(wait=False, cancel_futures=True)

    async def _process_loop(self) -> None:
        while True:
            task_id = await self.task_manager.queue.get()
            try:
                await self._process_detect(task_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.exception("detect failed for task %s", task_id)
                task = self.task_manager.tasks.get(task_id)
                if task is not None and task.detect_finished_at is None:
                    task.detect_finished_at = datetime.now()
                await self.task_manager.update_progress(
                    task_id, TaskStep.ERROR, 0.0, "偵測失敗", error=str(exc)
                )
                self.task_manager.save_history(task_id)

    async def _process_detect(self, task_id: str) -> None:
        task = self.task_manager.tasks[task_id]
        if task.video_path is None:
            raise RuntimeError(f"task {task_id} has no video_path")

        task.detect_started_at = datetime.now()
        await self.task_manager.update_progress(
            task_id, TaskStep.DETECTING, 0.0, "PHALP 偵測中…"
        )
        loop = asyncio.get_running_loop()
        out_dir = self.work_dir / task_id
        result = await loop.run_in_executor(
            self.executor,
            lambda: self.pipeline.step1_detect(
                task.video_path, out_dir,
                start_frame=task.start_frame,
                end_frame=task.end_frame,
                frame_step=task.frame_step,
            ),
        )
        task.pkl_path = str(result["pkl"])
        task.tracks = result["tracks"]
        task.total_frames = result.get("total_frames", 0)

        await self.task_manager.update_progress(
            task_id, TaskStep.RENDERING_OVERLAY, 0.5, "骨架 overlay 影片產生中…"
        )
        if hasattr(self.pipeline, "step1b_overlay"):
            overlay = await loop.run_in_executor(
                self.executor,
                lambda: self.pipeline.step1b_overlay(
                    task.pkl_path, out_dir, fps=task.native_fps / task.frame_step,
                ),
            )
            task.overlay_path = str(overlay)

        task.detect_finished_at = datetime.now()
        await self.task_manager.update_progress(
            task_id,
            TaskStep.TRACKS_READY,
            1.0,
            f"偵測完成，找到 {len(task.tracks)} 個 track",
        )
        self.task_manager.save_history(task_id)

    async def process_convert(
        self,
        task_id: str,
        track_id: int,
        fps: int,
        smoothing: bool,
    ) -> None:
        task = self.task_manager.tasks.get(task_id)
        if task is None:
            raise KeyError(task_id)
        if task.pkl_path is None:
            raise RuntimeError(f"task {task_id} has no pkl yet (status={task.status})")

        task.convert_started_at = datetime.now()
        task.convert_finished_at = None
        await self.task_manager.update_progress(
            task_id, TaskStep.CONVERTING, 0.5, "BVH 轉換中…"
        )
        loop = asyncio.get_running_loop()
        bvh_path = self.work_dir / task_id / "out.bvh"
        try:
            await loop.run_in_executor(
                self.executor,
                self.pipeline.step2_convert,
                task.pkl_path,
                bvh_path,
                track_id,
                fps,
                smoothing,
            )
        except Exception as exc:
            log.exception("convert failed for task %s", task_id)
            task.convert_finished_at = datetime.now()
            await self.task_manager.update_progress(
                task_id, TaskStep.ERROR, 0.0, "BVH 轉換失敗", error=str(exc)
            )
            self.task_manager.save_history(task_id)
            raise

        task.bvh_path = str(bvh_path)
        task.convert_finished_at = datetime.now()
        await self.task_manager.update_progress(
            task_id, TaskStep.BVH_READY, 1.0, "BVH 完成"
        )
        self.task_manager.save_history(task_id)
