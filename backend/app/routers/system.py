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


class SystemStats(BaseModel):
    cpu_pct: float
    gpu_name: str | None
    gpu_util_pct: int | None
    gpu_mem_used_mb: float | None
    gpu_mem_total_mb: float | None
    tasks_queued: int
    tasks_active: int
    tasks_total: int


@router.get("/system/stats", response_model=SystemStats)
async def get_system_stats(request: Request) -> SystemStats:
    tm = request.app.state.task_manager
    queued = sum(1 for t in tm.tasks.values() if t.status.value == "queued")
    active = sum(
        1 for t in tm.tasks.values()
        if t.status.value in ("detecting", "converting")
    )
    gpu = _gpu_usage()
    return SystemStats(
        cpu_pct=psutil.cpu_percent(interval=0.0),
        tasks_queued=queued,
        tasks_active=active,
        tasks_total=len(tm.tasks),
        **gpu,
    )
