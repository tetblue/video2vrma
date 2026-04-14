import psutil
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


def _gpu_usage() -> dict:
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        name = pynvml.nvmlDeviceGetName(handle)
        if isinstance(name, bytes):
            name = name.decode()
        pynvml.nvmlShutdown()
        return {
            "gpu_name": name,
            "gpu_util_pct": util.gpu,
            "gpu_mem_used_mb": round(mem.used / 1e6, 1),
            "gpu_mem_total_mb": round(mem.total / 1e6, 1),
        }
    except Exception:
        return {
            "gpu_name": None,
            "gpu_util_pct": None,
            "gpu_mem_used_mb": None,
            "gpu_mem_total_mb": None,
        }


class QueuedTaskBrief(BaseModel):
    task_id: str
    file_name: str
    client_id: str
    enqueued_at: str | None
    position: int


class SystemStats(BaseModel):
    cpu_pct: float
    gpu_name: str | None
    gpu_util_pct: int | None
    gpu_mem_used_mb: float | None
    gpu_mem_total_mb: float | None
    tasks_queued: int
    tasks_active: int
    tasks_total: int
    queued_tasks: list[QueuedTaskBrief] = []


@router.get("/system/stats", response_model=SystemStats)
async def get_system_stats(request: Request) -> SystemStats:
    tm = request.app.state.task_manager

    # 待處理與進行中（用 status 判斷，不看 asyncio.Queue 內容以避免干擾 worker）
    queued_states = {"queued", "detecting", "rendering_overlay"}
    # detecting/rendering_overlay 算 active（進行中），queued 算 queued
    pending = [t for t in tm.tasks.values() if t.status.value in queued_states]
    # 依 enqueued_at 排序；None 的排最後（通常是剛 create 還沒 enqueue）
    pending.sort(key=lambda t: t.enqueued_at or t.created_at)

    queued_list: list[QueuedTaskBrief] = []
    for i, t in enumerate(pending, start=1):
        queued_list.append(
            QueuedTaskBrief(
                task_id=t.task_id,
                file_name=t.file_name,
                client_id=t.client_id,
                enqueued_at=t.enqueued_at.isoformat() if t.enqueued_at else None,
                position=i,
            )
        )

    queued = sum(1 for t in tm.tasks.values() if t.status.value == "queued")
    active = sum(
        1 for t in tm.tasks.values()
        if t.status.value in ("detecting", "rendering_overlay", "converting")
    )
    gpu = _gpu_usage()
    return SystemStats(
        cpu_pct=psutil.cpu_percent(interval=0.0),
        tasks_queued=queued,
        tasks_active=active,
        tasks_total=len(tm.tasks),
        queued_tasks=queued_list,
        **gpu,
    )
