# video2vrma — MP4 to VRMA 動態捕捉轉換平台 開發計畫

## 專案概述

一個網頁應用程式，使用者上傳 MP4 影片，系統自動擷取人體動作並轉換成 VRMA (VRM Animation) 格式。後端使用 Python (FastAPI)，前端使用 Node.js + TypeScript (Next.js)。

啟動方式：一個 Python 指令啟動後端，一個 npm 指令啟動前端，不需要額外安裝 Redis、Celery 或任何外部服務。

---

## 技術架構

### 轉換 Pipeline

```
前端上傳 MP4
    ↓
後端：PHALP (偵測+追蹤+SMPL) → smpl2bvh (BVH) → 回傳 BVH
    ↓
前端：bvh2vrma (VRMA) → 預覽 / 下載
```

- 後端負責：影片接收、人體偵測與追蹤 (PHALP/4D Humans)、SMPL 參數提取、BVH 轉換、動作平滑
- 前端負責：上傳 UI、進度顯示、BVH → VRMA 轉換 (瀏覽器內)、VRM 模型預覽、檔案下載

### 技術選型

| 層級 | 技術 |
|------|------|
| 前端框架 | Next.js + TypeScript |
| 3D 預覽 | Three.js + @pixiv/three-vrm + @pixiv/three-vrm-animation |
| BVH→VRMA | 前端瀏覽器內執行，參考 vendor/bvh2vrma 的轉換邏輯 |
| 後端框架 | FastAPI (Python) |
| 任務佇列 | 內建 asyncio.Queue + ThreadPoolExecutor (無外部依賴) |
| 任務狀態 | 記憶體內 dict + per-task JSON 持久化（7 天保留） |
| GPU 推理 | PHALP / 4D Humans (PyTorch + CUDA) |
| SMPL→BVH | smpl2bvh (Python) |
| 動作平滑 | scipy.signal (Savitzky-Golay filter) |

### 第三方專案 (全部本地 clone，直接 import 或參考原始碼，不使用 CLI)

| 專案 | 用途 | 整合方式 | 來源 |
|------|------|----------|------|
| 4D-Humans | HMR2.0 人體姿態估計 | 後端 Python import | https://github.com/shubham-goel/4D-Humans |
| PHALP | 多人追蹤 + SMPL 輸出 | 後端 Python import | https://github.com/brjathu/PHALP |
| smpl2bvh | SMPL → BVH 轉換 | 後端 Python import | https://github.com/KosukeFukazawa/smpl2bvh |
| bvh2vrma | BVH → VRMA 轉換 | 前端參考原始碼整合 | https://github.com/vrm-c/bvh2vrma |

### bvh2vrma 整合策略

bvh2vrma 是 VRM 官方 (vrm-c) 的 Next.js + TypeScript 專案，與我們的前端技術棧一致。整合方式：

1. **不直接跑 bvh2vrma 的 web app**，而是提取它的核心轉換邏輯
2. bvh2vrma 的 `src/` 目錄中包含 BVH 解析、骨架映射、VRMA glTF 組裝的完整邏輯
3. 將這些核心模組 import 到我們的前端 `services/bvhToVrma.ts` 中使用
4. 如果 bvh2vrma 的模組不方便直接 import（例如耦合了 UI 邏輯），則參考其原始碼重寫轉換邏輯

需要在 Phase 2 研讀 bvh2vrma 原始碼時，釐清以下問題：
- 核心轉換函式的入口在哪裡
- 它預設支援的 BVH 骨架命名格式（是否相容 smpl2bvh 的輸出）
- 如果不相容，需要在哪裡加入 SMPL 骨架名的自訂映射
- VRMA glTF 的組裝方式（用了哪些 three.js / glTF 相關套件）

### 啟動方式

```bash
# 終端機 1：後端
cd backend
python -m app.main

# 終端機 2：前端
cd frontend
npm run dev
```

不需要任何其他服務。

---

## 後端任務管理架構

不使用 Redis/Celery，改用 FastAPI 內建機制：

### 核心設計

```
FastAPI (async event loop)
    │
    ├── API 端點：接收請求、查詢狀態、WebSocket 推送
    │
    ├── TaskManager (singleton)
    │   ├── tasks: Dict[str, TaskState]     ← 記憶體內任務狀態
    │   ├── queue: asyncio.Queue            ← 待處理任務佇列
    │   └── subscribers: Dict[str, List[WebSocket]]  ← 進度訂閱者
    │
    └── GPU Worker (背景線程，啟動時自動開始)
        ├── 從 queue 取任務
        ├── 在 ThreadPoolExecutor 中執行 GPU 推理
        ├── 更新 TaskState
        └── 透過 subscribers 推送進度
```

### TaskManager 設計

```python
import asyncio
import uuid
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
from pathlib import Path

class TaskStep(str, Enum):
    QUEUED = "queued"
    DETECTING = "detecting"
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
    video_path: Optional[str] = None
    tracks: Optional[dict] = None
    bvh_content: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)

class TaskManager:
    def __init__(self):
        self.tasks: dict[str, TaskState] = {}
        self.queue: asyncio.Queue = asyncio.Queue()
        self.subscribers: dict[str, list] = {}

    def create_task(self, video_path: str) -> str:
        task_id = str(uuid.uuid4())[:8]
        self.tasks[task_id] = TaskState(
            task_id=task_id, video_path=video_path
        )
        return task_id

    async def enqueue(self, task_id: str):
        await self.queue.put(task_id)

    async def update_progress(self, task_id, status, progress, message):
        task = self.tasks[task_id]
        task.status = status
        task.progress = progress
        task.message = message
        await self._notify_subscribers(task_id)

    async def _notify_subscribers(self, task_id):
        task = self.tasks[task_id]
        msg = {"type": "progress", "step": task.status.value,
               "progress": task.progress, "message": task.message}
        dead = []
        for ws in self.subscribers.get(task_id, []):
            try:
                await ws.send_json(msg)
            except:
                dead.append(ws)
        for ws in dead:
            self.subscribers[task_id].remove(ws)

    def cleanup_old_tasks(self, max_age_hours=24):
        now = datetime.now()
        expired = [tid for tid, t in self.tasks.items()
                   if (now - t.created_at).total_seconds() > max_age_hours * 3600]
        for tid in expired:
            task = self.tasks.pop(tid)
            if task.video_path:
                Path(task.video_path).unlink(missing_ok=True)
```

### GPU Worker 設計

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

class GPUWorker:
    def __init__(self, task_manager, pipeline):
        self.task_manager = task_manager
        self.pipeline = pipeline
        self.executor = ThreadPoolExecutor(max_workers=1)

    async def start(self):
        asyncio.create_task(self._process_loop())

    async def _process_loop(self):
        while True:
            task_id = await self.task_manager.queue.get()
            try:
                await self._process_detect(task_id)
            except Exception as e:
                await self.task_manager.update_progress(
                    task_id, TaskStep.ERROR, 0, str(e))

    async def _process_detect(self, task_id):
        task = self.task_manager.tasks[task_id]
        loop = asyncio.get_event_loop()

        def progress_cb(progress, message):
            asyncio.run_coroutine_threadsafe(
                self.task_manager.update_progress(
                    task_id, TaskStep.DETECTING, progress, message),
                loop)

        tracks = await loop.run_in_executor(
            self.executor, self.pipeline.step1_detect,
            task.video_path, 0, -1, progress_cb)
        task.tracks = tracks
        await self.task_manager.update_progress(
            task_id, TaskStep.TRACKS_READY, 1.0,
            f"偵測完成，找到 {len(tracks)} 個人物")

    async def process_convert(self, task_id, track_id, fps, smooth):
        task = self.task_manager.tasks[task_id]
        loop = asyncio.get_event_loop()
        await self.task_manager.update_progress(
            task_id, TaskStep.CONVERTING, 0.5, "轉換 BVH 中...")
        bvh = await loop.run_in_executor(
            self.executor, self.pipeline.step2_convert,
            task.tracks, track_id, fps, smooth)
        task.bvh_content = bvh
        await self.task_manager.update_progress(
            task_id, TaskStep.BVH_READY, 1.0, "BVH 轉換完成")
```

### FastAPI main.py

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
import asyncio

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.task_manager = TaskManager()
    app.state.pipeline = ConversionPipeline(config)
    app.state.gpu_worker = GPUWorker(
        app.state.task_manager, app.state.pipeline)
    await app.state.gpu_worker.start()

    async def periodic_cleanup():
        while True:
            await asyncio.sleep(3600)
            app.state.task_manager.cleanup_old_tasks()
    cleanup_task = asyncio.create_task(periodic_cleanup())

    yield

    cleanup_task.cancel()
    app.state.pipeline.cleanup()

app = FastAPI(lifespan=lifespan)
app.include_router(upload_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 專案目錄結構

```
video2vrma/
│
├── DEVELOPMENT_PLAN.md
├── CLAUDE.md
├── WORKFLOW.md
├── vendor-versions.txt
├── .gitignore
│
├── .claude/                           # Claude Code 配置
│   ├── settings.json
│   ├── hooks/                         # 自動守則腳本
│   ├── commands/                      # slash commands
│   ├── agents/                        # subagent 定義
│   └── lessons/                       # 歷史教訓（INDEX.md 自動載入）
│
├── scripts/                           # 環境建置 / 診斷腳本
│   ├── env_check.py
│   ├── download_hmr2_data.py
│   ├── migrate_model_cache.py
│   └── ...（build/verify 腳本）
│
├── vendor/                            # 第三方依賴（只讀）
│   ├── 4d-humans/                     # Python — 後端 import
│   ├── PHALP/                         # Python — 後端 import
│   ├── smpl2bvh/                      # Python — 後端 import
│   └── bvh2vrma/                      # TypeScript — 前端參考原始碼
│
├── data/
│   └── smpl/                          # SMPL 模型（不進 git）
│
├── models/                            # 本機模型 cache（不進 git，~6.4 GB）
│   ├── _home/.cache/phalp/            # PHALP 權重
│   ├── _home/.cache/4DHumans/         # HMR2 checkpoint
│   └── iopath_cache/detectron2/       # ViTDet + mask_rcnn
│
├── backend/
│   ├── app/
│   │   ├── main.py                    # create_app + lifespan
│   │   ├── config.py                  # 路徑常數 + 預設參數
│   │   ├── routers/
│   │   │   ├── upload.py              # POST /api/upload
│   │   │   ├── tasks.py              # GET status/tracks/download + POST convert + DELETE + WS
│   │   │   ├── history.py            # GET /api/history + GET /api/r/{share_token}
│   │   │   └── system.py             # GET /api/system/stats
│   │   ├── services/
│   │   │   ├── vendor_paths.py       # env override + stub/patch
│   │   │   ├── phalp_service.py      # PHALP tracker 包裝
│   │   │   ├── track_extractor.py    # pkl → pose_aa，cam→VRM 翻轉
│   │   │   ├── smoothing.py          # Savitzky-Golay 平滑
│   │   │   ├── smpl_to_bvh_service.py # pose_aa → BVH
│   │   │   ├── preview.py            # 骨架 3D GIF + 2D overlay mp4（多 track 彩色標註）
│   │   │   └── pipeline.py           # step1_detect / step1b_overlay / step2_convert
│   │   ├── core/
│   │   │   ├── task_manager.py       # TaskState + TaskStep + queue + WS
│   │   │   └── gpu_worker.py         # 背景 worker
│   │   └── models/
│   │       └── schemas.py            # Pydantic request/response
│   ├── tests/                         # pytest 單元測試（29 tests）
│   ├── scripts/
│   │   └── test_e2e.py               # 端到端 CLI
│   └── pytest.ini
│
├── frontend/                          # Next.js 13.4 (app router)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # 完整流程頁
│   │   │   ├── r/[token]/page.tsx    # 公開分享頁（唯讀）
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── VideoUploader.tsx      # multipart 上傳
│   │   │   ├── TrimSlider.tsx         # range slider + playhead 裁切控制項
│   │   │   ├── ProgressDisplay.tsx    # 步驟條 + progress bar
│   │   │   ├── TrackSelector.tsx      # track 選擇
│   │   │   ├── ConversionPanel.tsx    # fps + smoothing + 轉換
│   │   │   ├── VrmPreview.tsx         # three + @pixiv/three-vrm 預覽
│   │   │   ├── ReviewPanel.tsx        # 三欄同步預覽（原始 / overlay / VRM）+ 裁切 loop
│   │   │   ├── SystemStats.tsx        # CPU / GPU / 佇列監控
│   │   │   └── HistoryPanel.tsx      # 轉換歷史記錄列表
│   │   ├── services/
│   │   │   ├── apiClient.ts           # fetch wrapper
│   │   │   └── bvhToVrma.ts          # bvhText → vrma blob
│   │   ├── hooks/
│   │   │   └── useTaskProgress.ts    # WebSocket 訂閱
│   │   ├── lib/
│   │   │   ├── bvh2vrma/             # vendor copy（5 檔）
│   │   │   └── clientId.ts           # localStorage client UUID
│   ├── public/models/default.vrm     # 預設 VRM 模型
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.js
│
└── tmp/                               # 暫存（不進 git）
    ├── uploads/                       # 上傳的影片
    ├── tasks/                         # 各任務的 pkl / overlay / bvh
    └── history/                       # per-task JSON 持久化（7 天保留）
```

---

## API 規格

### REST API

| 端點 | 方法 | 功能 | 請求/回應 |
|------|------|------|-----------|
| `/api/upload` | POST | 上傳 MP4 | multipart/form-data + `X-Client-Id` header → `{ task_id, share_token }` |
| `/api/tasks/{task_id}/status` | GET | 查詢任務狀態 | → `{ status, progress, step, message, error? }` |
| `/api/tasks/{task_id}/tracks` | GET | 取得人物列表 | → `{ tracks: [{ track_id, frame_count, start_frame }], detection_fps, total_frames }` |
| `/api/tasks/{task_id}/convert` | POST | 指定 track 轉 BVH | `{ track_id, fps?, smoothing? }` → `{ status }` |
| `/api/tasks/{task_id}/download/bvh` | GET | 下載 BVH | → BVH 檔案 |
| `/api/tasks/{task_id}/video` | GET | 串流原始影片 | → video/mp4 |
| `/api/tasks/{task_id}/overlay` | GET | 串流骨架 overlay 影片 | → video/mp4（多 track 彩色標註 + ID 標籤） |
| `/api/tasks/{task_id}` | DELETE | 刪除自己的任務 | `X-Client-Id` header → `{ deleted }` |
| `/api/history` | GET | 列出使用者的轉換記錄 | `X-Client-Id` header → `[{ task_id, share_token, file_name, status, created_at, has_bvh, has_overlay, error? }]` |
| `/api/r/{share_token}` | GET | 公開短連結查詢 | → `{ task_id, file_name, status, created_at, has_bvh, has_overlay, has_video, tracks?, detection_fps?, total_frames? }` |
| `/api/system/stats` | GET | 系統狀態 | → `{ cpu_pct, gpu_name, gpu_util_pct, gpu_mem_*, tasks_* }` |

### WebSocket

| 端點 | 功能 |
|------|------|
| `/api/ws/tasks/{task_id}` | 即時推送處理進度 |

### 任務狀態機

```
QUEUED → DETECTING → RENDERING_OVERLAY → TRACKS_READY → (等使用者選 track)
                                                              ↓
                                                         CONVERTING → BVH_READY
                                                              ↓
                                                            ERROR (任何階段)
```

---

## 前端 bvh2vrma 整合細節

### vendor/bvh2vrma 原始碼結構（需在 Phase 2 確認）

```
vendor/bvh2vrma/
├── src/
│   ├── app/          # Next.js 頁面 (不需要)
│   ├── features/     # 可能包含核心轉換邏輯
│   └── lib/          # 工具函式
├── package.json      # 確認依賴版本 (three.js, @pixiv/three-vrm 等)
└── ...
```

### 整合步驟

1. **研讀 vendor/bvh2vrma/src/**，找到核心轉換函式
   - BVH 解析的入口
   - 骨架映射邏輯（BVH bone name → VRM humanoid bone）
   - VRMA glTF 組裝與匯出

2. **確認它依賴的 npm 套件版本**，在我們的 frontend/package.json 中安裝相同版本
   ```bash
   cd vendor/bvh2vrma && cat package.json | grep -A 20 dependencies
   ```

3. **兩種整合方式（Phase 2 決定）：**

   **方式 A：直接 import 模組**
   如果 bvh2vrma 的轉換邏輯獨立於 UI，可以用 TypeScript path alias 直接 import：
   ```json
   // frontend/tsconfig.json
   {
     "compilerOptions": {
       "paths": {
         "@bvh2vrma/*": ["../vendor/bvh2vrma/src/*"]
       }
     }
   }
   ```
   ```typescript
   // frontend/src/services/bvhToVrma.ts
   import { convertBvhToVrma } from '@bvh2vrma/features/convert';
   ```

   **方式 B：提取核心邏輯**
   如果轉換邏輯跟 UI 耦合太深，則參考原始碼，將核心邏輯重寫到我們的 `bvhToVrma.ts` 中。

4. **加入 SMPL 骨架映射**
   bvh2vrma 預設處理的可能是 Mixamo 等標準 BVH 格式。
   需要確認它的骨架映射表，並加入 SMPL 骨架名的支援：
   ```typescript
   // 如果 bvh2vrma 內建映射不含 SMPL 命名，需要擴充
   const SMPL_TO_VRM_BONE_MAP: Record<string, string> = {
     'Pelvis':     'hips',
     'L_Hip':      'leftUpperLeg',
     'R_Hip':      'rightUpperLeg',
     'Spine1':     'spine',
     'L_Knee':     'leftLowerLeg',
     'R_Knee':     'rightLowerLeg',
     'Spine2':     'chest',
     'L_Ankle':    'leftFoot',
     'R_Ankle':    'rightFoot',
     'Spine3':     'upperChest',
     'L_Foot':     'leftToes',
     'R_Foot':     'rightToes',
     'Neck':       'neck',
     'L_Collar':   'leftShoulder',
     'R_Collar':   'rightShoulder',
     'Head':       'head',
     'L_Shoulder': 'leftUpperArm',
     'R_Shoulder': 'rightUpperArm',
     'L_Elbow':    'leftLowerArm',
     'R_Elbow':    'rightLowerArm',
     'L_Wrist':    'leftHand',
     'R_Wrist':    'rightHand',
   };
   ```

---

## 環境現狀檢查（2026-04-11）

### 硬體 / 作業系統
- OS：Windows 11 (10.0.26200)
- GPU：NVIDIA GeForce RTX 5070 Ti Laptop（Compute Capability 12.0 / sm_120）
- CUDA Toolkit：12.8（`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8`）

### Conda 環境
- 環境名稱：`aicuda`
- Python：3.12.11
- 路徑：`C:\Users\LOREN\miniconda3\envs\aicuda`
- 其他可用環境（僅供參考，不使用）：aiamd, aibackend, airuntime, cuda128, ryzen-ai-1.5.0

### 關鍵套件（aicuda 已安裝）

| 套件 | 版本 | 備註 |
|------|------|------|
| torch | 2.7.1+cu128 | CUDA 可用，`torch.version.cuda=12.8` |
| torchvision | 0.22.1+cu128 | |
| torchaudio | 2.7.1+cu128 | |
| pytorch-lightning | 1.9.5 | 4D-Humans 相容版本 |
| hmr2 | (vendor/4d-humans) | import OK |
| phalp | (vendor/PHALP) | import OK |
| hydra-core | 1.3.2 | |
| omegaconf | 2.3.0 | |
| transformers | 4.54.1 | |
| opencv-python | 4.12.0.88 | |
| mediapipe | 0.10.33 | |
| pyrender | 0.1.45 | |
| trimesh | 4.11.2 | |
| scipy | 1.16.1 | |
| numpy | 2.2.6 | ⚠️ 2.x，部分舊套件可能有相容性問題 |
| fastapi | 0.116.1 | |
| uvicorn | 0.35.0 | |
| websockets | 15.0.1 | |
| chumpy | 0.71 | SMPL 載入需要 |
| yacs | 已安裝 | |

### ⚠️ 缺失套件（必須補裝）

| 套件 | 用途 | 安裝建議 |
|------|------|----------|
| **smplx** | SMPL/SMPL-X 身體模型載入（4D-Humans、PHALP 核心依賴） | `pip install smplx` |
| **pytorch3d** | 3D 幾何運算（PHALP / 4D-Humans 可能使用） | Windows 上需從原始碼或 wheel 安裝；先嘗試 `pip install pytorch3d`，若失敗則參考 vendor/4d-humans/environment.yml |
| **detectron2** | PHALP 使用的偵測後端 | Windows 不支援官方 wheel，需 `pip install "git+https://github.com/facebookresearch/detectron2.git"` 並有 VS Build Tools；或改用 PHALP 的 ViTDet 路徑 |
| python-multipart | FastAPI 檔案上傳 | `pip install python-multipart`（確認） |

### 專案檔案狀態

```
video2vrma/
├── DEVELOPMENT_PLAN.md        ✅ 本檔案
├── CLAUDE.md                  ✅ Claude Code 規範
├── WORKFLOW.md                ✅ 人類使用說明
├── vendor-versions.txt        ✅ vendor commit hash 固定
├── .gitignore                 ✅ 已設定
├── .claude/                   ✅ hooks / commands / agents / lessons 齊全
├── data/smpl/                 ✅ SMPL 模型已放入
├── models/                    ✅ 模型 cache 本機化（~6.4 GB）
├── vendor/                    ✅ 四個第三方專案已 clone
├── backend/                   ✅ FastAPI + services + tests 完成
├── frontend/                  ✅ Next.js + 完整 UI 完成
└── tmp/                       ✅ 暫存目錄
```

### 重要發現與需要注意的事項

1. **RTX 5070 Ti（sm_120）是相對新的架構**：torch 2.7.1+cu128 已支援，CUDA runtime 測試可用；但部分預編 wheel（如 detectron2、pytorch3d）可能沒有對應 sm_120 的 binary，需要從原始碼編譯或改用 JIT。
2. **Python 3.12 + NumPy 2.2**：舊版 4D-Humans / PHALP 原本是 Python 3.10 + NumPy 1.x 環境，可能會遇到 `np.float`、`np.int` 等已移除 API 的錯誤。Phase 1 跑通時若遇到要準備 patch。
3. **bvh2vrma 使用 pages router（Next.js 13.4）**，核心轉換邏輯集中在 `src/lib/bvh-converter/` 與 `src/lib/VRMAnimation/`，與 UI 解耦度看起來良好，Phase 2 有機會採用「方式 A：直接 import」。
4. **detectron2 在 Windows 安裝困難**：若補裝卡住，考慮在 PHALP 設定中改用其他偵測器（如 4D-Humans 原生的 ViTDet）。
5. **python-multipart** 尚未確認，FastAPI 上傳檔案時需要；Phase 0.6 安裝清單已列，Phase 0 實際執行時需確認。

---

## 開發階段規劃

### Phase 0：環境建置與專案初始化

**目標：** 開發環境就緒，所有依賴可用。

**任務：**

- [x] 0.1 建立 video2vrma/ 專案根目錄結構（根目錄 + data/ + vendor/ 已存在；backend/frontend/tmp 待建）
- [x] 0.2 Clone 所有第三方專案（4d-humans, PHALP, smpl2bvh, bvh2vrma 已存在 vendor/）
  - [x] 0.2.1 產生 vendor-versions.txt 固定 commit hash
- [x] 0.3 建立 conda 環境 + PyTorch CUDA（aicuda：Python 3.12.11 + torch 2.7.1+cu128，CUDA 測試通過）
- [x] 0.4 安裝 vendor Python 依賴
  - [x] hmr2, phalp, pytorch-lightning 1.9.5, hydra, omegaconf, transformers, opencv, mediapipe, pyrender, trimesh, scipy, chumpy, yacs ✅
  - [x] **smplx** 0.1.28 已裝
  - [x] **pytorch3d** 0.7.9 已裝（從 `git+main` 原始碼編譯；stable 的 pulsar 子模組撞到 CUDA 12.8 libcu++ 新 header，main 已修；sm_120 CUDA kernel 實測可用）
  - [x] **detectron2** 0.6 已裝（從 `git+main` 原始碼編譯成功，nms CUDA kernel 在 sm_120 實測可用）
- [x] 0.5 下載 SMPL 模型 → data/smpl/（SMPL_NEUTRAL.npz + m/f/neutral pkl 全部就位）
- [x] 0.6 安裝後端依賴：fastapi / uvicorn / python-multipart / websockets / scipy 全部就位
- [x] 0.7 初始化前端 Next.js + three-vrm 套件
  - 版本對齊 vendor/bvh2vrma：`next@13.4.4`、`three@^0.153.0`、`@pixiv/three-vrm@^2.1.0`、`@pixiv/three-vrm-animation@^2.1.0`、`@gltf-transform/core@^3.4.0`、`react@18.2.0`
  - npm 嚴格 peer-deps 檢查會與 bvh2vrma 原 yarn 解析差異衝突，因此在 `frontend/.npmrc` 開 `legacy-peer-deps=true`，對齊 yarn 行為
  - 使用 app router（`src/app/`），若 Phase 2 要直接 import vendor/bvh2vrma 的 lib 再評估是否要切回 pages router
- [x] 0.8 撰寫 CLAUDE.md
- [x] 0.9 建立 .gitignore（已加入 vendor/、data/smpl/、tmp/、node_modules/、.next/、模型權重 等）

**驗收：** import hmr2 / phalp 不報錯 ✅、smplx 可載入、前後端可啟動、vendor/bvh2vrma 能 yarn install && yarn dev 獨立跑起來

---

### Phase 1：後端 Pipeline 跑通（最關鍵）

**目標：** 純 Python 腳本走完 PHALP → smpl2bvh → BVH 輸出。

**任務：**

- [x] 1.1 準備測試影片（`dance.mp4`，使用者提供，192 frames）
- [x] 1.2 研讀 PHALP 原始碼，找最小初始化路徑
  - 使用 `OmegaConf.structured(Human4DConfig())` 建 cfg，`video.source` 傳 posix 絕對路徑
  - `HMR2_4dhuman(cfg).track()` 即可；cfg.render.enable=False、overwrite=False
- [x] 1.3 撰寫 `backend/scripts/test_e2e.py` 與 `backend/app/services/{phalp_service,smpl_to_bvh_service,pipeline,vendor_paths}.py`
- [x] 1.4 驗證 PHALP 輸出 pkl 結構
  - 頂層 dict 以 frame_name 為 key，每幀含 `tid / smpl / camera / 2d_joints / 3d_joints / bbox / ...`
  - `smpl[i]` = `{'global_orient':(1,3,3), 'body_pose':(23,3,3), 'betas':(10,)}` rotation matrix
- [x] 1.5 研讀 smpl2bvh 原始碼，確認輸入輸出格式
  - `smpl2bvh(model_path, poses, output, ...)` 需要 `.pkl` 含 `smpl_poses (N,72) axis-angle, smpl_trans (N,3), smpl_scaling (1,)`
  - smplx.create 要 `<model_path>/smpl/SMPL_NEUTRAL.{pkl,npz}` 巢狀 layout
- [x] 1.6 PHALP → smpl2bvh 銜接：`extract_longest_track()` 挑最長 track，用 scipy `Rotation.from_matrix().as_rotvec()` 轉 axis-angle
- [x] 1.7 用 Blender 驗證 BVH 骨架命名（使用者手動確認通過，smpl2bvh 24 joints 命名 Pelvis / L_Hip / R_Hip / ... / L_Wrist / R_Wrist / L_Palm / R_Palm 可在 Blender 正常播放）

**Phase 1 環境補丁（關鍵記錄）**

為了讓 vendor/ 的 PHALP / 4D-Humans 在 Windows + Py3.12 + torch 2.7 環境下跑起來，`backend/app/services/vendor_paths.py` 做了以下 side-effect 式 patch（不動 vendor/）：

1. `HOME` env var 補成 `USERPROFILE`（PHALP 的 `CACHE_DIR` 依賴）
2. `pyrender` / `phalp.visualize.py_renderer` / `neural_renderer` 三個 module 用 permissive stub 攔截（Windows 沒 libEGL、neural_renderer 沒 wheel；Phase 1 不需要 render）
3. `torch.load` 預設 `weights_only=False`（PyTorch 2.6+ 預設擋掉含 omegaconf 的 Lightning checkpoint）
4. `phalp_service._patch_hmr2_skip_renderer()` 把 `hmr2.models.hmr2.HMR2.__init__` 預設 `init_renderer=False`，避免 Lightning reconstruct 時實例化需要 pyrender 的 renderer
5. `_prepopulate_smpl_caches()`：把 `data/smpl/basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl` 轉 py3 pickle 後放到 PHALP 與 4D-Humans 各自的 cache 路徑，跳過 vendor 內硬寫 `wget` 下載指令（Windows 沒 wget）
6. `scripts/download_hmr2_data.py` 處理 4D-Humans 的 2.7GB checkpoint tarball（URL 的 `.tar.gz` 其實是未壓縮 tar，自動偵測 magic 用 `r:` 模式解壓）

**Phase 1 缺的 vendor 依賴（已補裝到 aicuda）**：`dill` / `webdataset` / `scenedetect` / `braceexpand` / `timm` / `einops` / `scikit-image` / `pandas` / `gdown` / `cmake`

**驗收：**
- ✅ `conda run -n aicuda python backend/scripts/test_e2e.py --video dance.mp4 --end-frame 120` 跑通
- ✅ PHALP tracking 首次跑約 6 分 27 秒（192 frames），在 5070 Ti sm_120 上 CUDA 記憶體佔用 6.3GB（所有模型都在 cuda:0）
- ✅ 第二次跑（reuse pkl）BVH + GIF 只花 ~29s
- ✅ 產出 `tmp/phase1/phalp/results/demo_dance.pkl`（120 frames × 1 track）
- ✅ 產出 `tmp/phase1/dance.bvh`（94KB，24 joints SMPL hierarchy，`Frames: 120`，pose axis-angle abs-mean=0.30）
- ✅ 產出 `tmp/phase1/dance_skeleton.gif`（~1.6MB，matplotlib 3D，相機座標 Y 反向後正向直立）
- ✅ 產出 `tmp/phase1/dance_overlay.mp4`（~7.6MB，原始影片上疊骨架 2D joints，用 PHALP `2d_joints` 經 `new_image_size=max(H,W)` 反 padding 還原到原圖 pixel 座標）
- ✅ 1.7 Blender 骨架命名驗證通過（使用者手動確認）

**模型 cache 本機化（6.4 GB）**

為了避免每次重新下載，所有 vendor 用到的模型權重都透過 env 重導向到專案下的 `models/` 目錄：

- `os.environ["HOME"] = <project>/models/_home` → PHALP 與 4D-Humans 的 `CACHE_DIR` 都落在 `models/_home/.cache/`
- `os.environ["FVCORE_CACHE"] = <project>/models/iopath_cache` → detectron2 的 ViTDet / mask_rcnn checkpoint 落在 `models/iopath_cache/detectron2/`
- 首次遷移：`conda run -n aicuda python scripts/migrate_model_cache.py` 把 `$USERPROFILE/.cache/phalp|4DHumans` 與 `$USERPROFILE/.torch/iopath_cache` 搬到 `models/` 下，刪掉 2.7GB 的冗餘 hmr2_data.tar.gz
- 為了不讓 `hmr2.models.download_models` 誤以為 tarball 不存在而重新下載，`vendor_paths.py` 會在解壓標記檔存在時補一個 0 byte 的 `hmr2_data.tar.gz` placeholder
- `models/` 已加進 `.gitignore`

---

### Phase 2：前端 BVH → VRMA 驗證

**目標：** 瀏覽器中 BVH → VRMA → VRM 預覽。

**任務：**

- [x] 2.1 研讀 vendor/bvh2vrma/src/ 原始碼
  - 入口：`convertBVHToVRMAnimation(bvh, options) -> ArrayBuffer`（.vrma 是帶 VRMC_vrm_animation extension 的 glb）
  - 播放：`@pixiv/three-vrm-animation` 的 `VRMAnimationLoaderPlugin` + `createVRMAnimationClip`
  - 預設 scale=0.01（BVH cm → VRM m），smpl2bvh 輸出已 ×100 cm 所以用預設即可
- [x] 2.2 確認 bvh2vrma 預設支援的 BVH 骨架格式
  - bvh2vrma **沒有 hardcoded map**，用 `mapSkeletonToVRM` 結構啟發式 + 名稱模糊匹配
  - SMPL 24 joints 經由結構規則（Pelvis 是唯一三叉骨 → hips；Spine1/2/3 → spine/chest/upperChest；longest-bones-by-depth → 四肢）**自動對應成功**
  - 注意：`Left_palm` / `Right_palm` orphaned（VRM 沒有 palm bone），`toes` 沒有映射，可接受
- [x] 2.3 整合方式：採方式 B 的 variant — 把 5 個純轉換 TS 檔從 `vendor/bvh2vrma/src/lib/bvh-converter/` 複製到 `frontend/src/lib/bvh2vrma/`
  - 原因：Next.js 跨目錄 TS 編譯需要 webpack 額外配置且易踩雷，而檔案自成單元（~500 行無外部 deps 除了 three/three-vrm）
  - vendor-versions.txt 固定 hash，未來 vendor 升版可手動 re-copy
- [x] 2.4 實作 `frontend/src/services/bvhToVrma.ts`（`bvhTextToVrmaBlob(bvhText, {scale})`，用 three 的 BVHLoader 解析後丟進 convertBVHToVRMAnimation）
- [x] 2.5 建前端測試頁面 `frontend/src/app/page.tsx`：檔案選擇器 → 自動轉 VRMA → 下載按鈕 + 3D 預覽
- [x] 2.6 實作 `frontend/src/components/VrmPreview.tsx`：three WebGLRenderer + OrbitControls + VRMLoaderPlugin + VRMAnimationLoaderPlugin，AnimationMixer 播放
- [x] 2.7 驗證動畫品質（使用者手動在瀏覽器確認通過）
  - 過程中解決 4 個跨前後端 coordinate 問題：
    1. VRM 預設面向 +Z 而 three.js 相機在 +Z 看 −Z → vrm.scene `rotation.y = Math.PI` 讓角色面對相機
    2. PHALP `global_orient` 是相機座標 (Y down, Z forward) → 在 `smpl_to_bvh_service.extract_longest_track` 對 root rotation 左乘 `_R_CAM_TO_VRM = diag(1,-1,-1)` 轉到 VRM 世界
    3. bvh2vrma 預設會輸出 hips position track (all-zero 相對位移)，`createVRMAnimationClip` 會把零值寫到 Normalized_Hips local position，把 VRM hips 拉到世界原點造成角色沉入地面 → 自訂 `convertBVHToVRMAnimation.ts` 完全不輸出 hips position track
    4. 拿掉 hips position track 後，原本依賴 auto-grounding 把 skeleton bbox min.y 抬到 0 仍需保留，否則 exported glb 的 rest hips world Y 是負值，導致 mixer binding 失效整個 clip 都不動
- [x] 2.8 預設 VRM 模型 `frontend/public/models/default.vrm`（使用者提供 RINDO_Full.vrm 複製過去，52 MB）

**驗收：**
- ✅ `npm run typecheck` 無錯誤
- ✅ `npm run build` Next.js 端到端編譯成功（/ app route 281 KB first load）
- ✅ 使用者手動在 `npm run dev` 頁面上傳 `tmp/phase1/dance.bvh` 確認角色站在地面、面對相機、動畫播放正常

---

### Phase 3：後端 Service 層封裝

**目標：** 測試腳本拆成正式 service 模組。

- [x] 3.1 config.py
- [x] 3.2 phalp_service.py
- [x] 3.3 track_extractor.py
- [x] 3.4 smoothing.py
- [x] 3.5 smpl_to_bvh_service.py
- [x] 3.6 pipeline.py
- [x] 3.7 單元測試

**驗收：** pipeline 測試通過

---

### Phase 4：後端 API 與任務管理

**目標：** FastAPI + 記憶體內任務佇列，一個指令啟動。

- [x] 4.1 task_manager.py
- [x] 4.2 gpu_worker.py
- [x] 4.3 main.py (lifespan + uvicorn)
- [x] 4.4 schemas.py
- [x] 4.5 upload.py router
- [x] 4.6 tasks.py router (含 WebSocket)
- [x] 4.7 API 測試

**驗收：** `python -m app.main` 啟動，curl 走完流程

---

### Phase 5：前端 UI 開發

- [x] 5.1 VideoUploader.tsx
- [x] 5.2 apiClient.ts
- [x] 5.3 useTaskProgress.ts (WebSocket)
- [x] 5.4 ProgressDisplay.tsx
- [x] 5.5 TrackSelector.tsx
- [x] 5.6 ConversionPanel.tsx
- [x] 5.7 整合 VrmPreview.tsx
- [x] 5.8 頁面佈局和 UX

**驗收：** 完整使用者流程可走通

---

### Phase 5b：追加功能（Phase 5 後持續開發）

- [x] 5b.1 系統狀態監控（CPU / GPU / 佇列）— 後端 `system.py` + 前端 `SystemStats.tsx`
- [x] 5b.2 BVH / VRMA 分別下載按鈕，進度列顯示處理中影片名稱
- [x] 5b.3 三欄同步預覽面板 `ReviewPanel.tsx`：原始影片 / 骨架 overlay / VRM 動畫同步播放暫停
- [x] 5b.4 骨架 overlay 影片：2D overlay mp4 + ffmpeg H.264 重編碼（瀏覽器相容）
- [x] 5b.5 overlay 影片標示所有 track ID + 不同顏色骨架，方便選擇 track
- [x] 5b.6 影片時間段選擇器：上傳前可用 range slider 設定起始與結束點，支援 playhead 拖曳
- [x] 5b.7 裁切區段整合到 ReviewPanel：轉換前預覽裁切片段 loop，轉換後三窗格同步播放裁切區段
- [x] 5b.8 修正 start_frame 未傳入 PHALP pipeline：選中間區段時 PHALP 只處理該區段（修正雙層幀過濾 bug）
- [x] 5b.9 修正後半段 track 同步播放不可見：傳遞 per-track start_frame，VRM 動畫依 overlay 時間軸精確偏移
- [x] 5b.10 修正 overlay FPS：使用影片原生 FPS 取代固定 30，解決非 30fps 影片時長不一致

### Phase 6：優化與錯誤處理

- [ ] 6.1 錯誤處理
- [ ] 6.2 Web Worker (bvhToVrma)
- [ ] 6.3 效能優化
- [ ] 6.4 輸入驗證
- [ ] 6.5 日誌
- [ ] 6.6 佇列狀態顯示（部分已由 5b.1 SystemStats 完成）

---

### Phase 7：轉換歷史記錄與分享

**目標：** 使用者無需登入即可自動保留轉換記錄（7 天），可重新檢視、下載、分享或刪除。

**設計決策：**

- 使用者識別：前端 `localStorage` 存 UUID (`clientId`)，每次請求帶 `X-Client-Id` header
- 持久化：每個 task 一個 JSON 檔（`tmp/history/{task_id}.json`），啟動時載入
- 分享：每個 task 產生 12 字元 `share_token`，公開短連結 `/r/{share_token}`
- 保留期限：7 天，自動清理 JSON + 影片 + pkl + overlay + BVH
- 安全性：刪除操作需 `clientId` 匹配；`share_token` 獨立於 `clientId`（不洩漏身份）

**JSON 持久化格式（`tmp/history/{task_id}.json`）：**

```json
{
  "task_id": "a1b2c3d4",
  "client_id": "uuid-from-header",
  "share_token": "abcdef123456",
  "file_name": "dance.mp4",
  "status": "bvh_ready",
  "video_path": "tmp/uploads/a1b2c3d4.mp4",
  "overlay_path": "tmp/tasks/a1b2c3d4/overlay.mp4",
  "bvh_path": "tmp/tasks/a1b2c3d4/out.bvh",
  "pkl_path": "tmp/tasks/a1b2c3d4/phalp/results/demo_....pkl",
  "native_fps": 30.0,
  "tracks": [{"track_id": 0, "frame_count": 120, "start_frame": 0}],
  "total_frames": 120,
  "start_frame": 0,
  "end_frame": -1,
  "error": null,
  "created_at": "2026-04-13T10:30:00"
}
```

寫入時機（僅在穩定狀態，不在高頻 progress 更新時）：

```
upload  → QUEUED       → save ✓
detect  → TRACKS_READY → save ✓
convert → BVH_READY    → save ✓
error   → ERROR        → save ✓
```

**Phase 7a：後端持久化基礎**

- [x] 7a.1 `task_manager.py`：TaskState 新增 `client_id: str`、`share_token: str`、`file_name: str` 欄位
- [x] 7a.2 `task_manager.py`：新增 `to_persist_dict()` 方法（序列化結果欄位，排除暫態 progress/message）
- [x] 7a.3 `task_manager.py`：新增 `@classmethod from_persist_dict()` 方法（從 JSON 重建 TaskState）
- [x] 7a.4 `task_manager.py`：新增 `history_dir: Path` 參數，`save_history(task_id)` 方法（atomic write：寫 .tmp → rename）
- [x] 7a.5 `task_manager.py`：新增 `_share_index: dict[str, str]`（share_token → task_id），`get_by_share_token()` 方法
- [x] 7a.6 `task_manager.py`：新增 `load_history()` 方法（啟動時掃描 `history_dir/*.json`，跳過 >7 天或檔案遺失的）
- [x] 7a.7 `task_manager.py`：新增 `delete_task(task_id)` 方法（刪記憶體 + 所有檔案 + work dir + JSON + share_index）
- [x] 7a.8 `task_manager.py`：`cleanup_old_tasks` 改 7 天（`max_age_hours=168`），加刪 JSON + work dir + share_index
- [x] 7a.9 `main.py`：建立 `history_dir = TMP / "history"`，傳給 TaskManager，啟動時呼叫 `load_history()`
- [x] 7a.10 `upload.py`：讀 `X-Client-Id` header，設定 `task.client_id` / `share_token` / `file_name`，呼叫 `save_history()`
- [x] 7a.11 `upload.py`：`UploadResponse` 加 `share_token: str`
- [x] 7a.12 `gpu_worker.py`：detect 完成（TRACKS_READY）、convert 完成（BVH_READY）、error 時呼叫 `save_history()`
- [x] 7a.13 `schemas.py`：新增 `HistoryItem`、`SharedTaskResponse` 模型，更新 `UploadResponse`
- [x] 7a.14 `tests/test_api.py`：更新 stub + 新增持久化相關測試

**驗收：** `pytest tests/ -x` 全過，curl `POST /api/upload` 回傳 `share_token`，重啟後端後 task 仍存在

**Phase 7b：後端 API 端點**

- [x] 7b.1 新建 `routers/history.py`：`GET /api/history`（依 `X-Client-Id` 篩選，按時間倒序）
- [x] 7b.2 `routers/history.py`：`GET /api/r/{share_token}`（公開，回傳 task 資訊 + 下載連結，404 若已刪除）
- [x] 7b.3 `routers/tasks.py`：`DELETE /api/tasks/{task_id}`（驗證 `X-Client-Id` 匹配，403 若非本人）
- [x] 7b.4 `main.py`：註冊 history router（`app.include_router(history_router, prefix="/api")`）

**驗收：** curl 可打 `GET /api/history`、`GET /api/r/{token}`、`DELETE /api/tasks/{id}`

**Phase 7c：前端 Client ID 與 API 整合**

- [x] 7c.1 新建 `lib/clientId.ts`：`getClientId()` → `crypto.randomUUID()` + `localStorage`
- [x] 7c.2 `apiClient.ts`：`clientHeaders()` helper，所有 fetch 呼叫加 `X-Client-Id` header
- [x] 7c.3 `apiClient.ts`：新增 `getHistory()`、`getSharedTask(token)`、`deleteTask(taskId)` 函式與型別
- [x] 7c.4 `apiClient.ts`：更新 `uploadVideo` 回傳型別�� `share_token`

**驗收：** `tsc --noEmit` 通過，現有功能不受影響

**Phase 7d：前端歷史記錄 UI**

- [x] 7d.1 新建 `components/HistoryPanel.tsx`：列表顯示檔名、狀態標籤、相對時間、載入 / 分享 / 刪除按鈕
- [x] 7d.2 `page.tsx`：新增 `onLoadTask(taskId, fileName)` 回調（fetch status → tracks → BVH → 恢復狀態）
- [x] 7d.3 `page.tsx`：整合 HistoryPanel（`<details>` 摺疊區塊，放在上傳區上方）
- [x] 7d.4 `page.tsx`：上傳後儲存 `shareToken` state，顯示可複製的分享連結

**驗收：** 開瀏覽器 → 歷史列表可展開、載入舊任務可檢視/下載、刪除有確認對話框、分享連結可複製

**Phase 7e：分享頁面**

- [x] 7e.1 新建 `app/r/[token]/page.tsx`：唯讀檢視 + 下載按鈕（BVH / VRMA）
- [x] 7e.2 分享頁可選顯示影片 / overlay / VRM 預覽（複用現有元件）

**驗收：** 開啟 `http://localhost:3000/r/{token}` 可看到任務資訊與下載按鈕

---

### Phase 8：間隔取幀加速與動畫補幀

**目標：** 透過間隔取幀（`every_x_frame`）大幅縮短 PHALP 偵測時間，搭配兩階段流程讓使用者先快速預覽再精確轉換；可選的 SLERP 插值補幀提升動畫流暢度。

**背景：** PHALP 偵測是整個 pipeline 最大瓶頸（192 幀 ≈ 6 分鐘），每幀約 2 秒 GPU 推理。間隔 5 幀可將偵測時間縮短至 ~1/5。

**技術限制：**
- `vendor/` 只讀 — PHALP 的 `every_x_frame=1` 硬寫在 `vendor/PHALP/phalp/utils/io.py:56`，需透過 monkey-patch 繞過
- PHALP `extract_frames` 輸出的檔名是連續編號（img_cnt），pkl frame key 不反映實際影片幀號
- 間隔取幀後 `track_extractor` 的 `start_frame` 是取樣後的 index，非原始幀號，需乘以 `frame_step` 換算
- overlay FPS 需除以 `frame_step` 才能維持正確播放速度

**Phase 8a：間隔取幀 + 兩階段流程（A+C 混合）**

資料流變化：

```
上傳時選擇「快速模式」(frame_step=3~5)
    ↓
PHALP 只處理 1/N 幀（速度 ↑ N 倍）
    ↓
overlay FPS = native_fps / frame_step（播放速度正確）
    ↓
使用者預覽 track、選擇 → 可選「精確模式重跑」(frame_step=1)
```

後端改動（參數傳遞鏈）：

```
upload.py (frame_step Form param)
  → task_manager.py (TaskState.frame_step)
    → gpu_worker.py (傳給 step1_detect)
      → pipeline.py (step1_detect 接受 frame_step)
        → phalp_service.py (run_phalp 接受 every_x_frame)
          → vendor_paths.py (monkey-patch extract_frames 讀取 cfg 欄位)
```

任務清單：

- [x] 8a.1 `vendor_paths.py`：monkey-patch `FrameExtractor.extract_frames`，讓 `every_x_frame` 透過全域變數控制（而非硬寫 1）
- [x] 8a.2 `phalp_service.py`：`run_phalp()` 新增 `every_x_frame: int = 1` 參數，呼叫 `set_every_x_frame()` 設定
- [x] 8a.3 `pipeline.py`：`step1_detect()` 新增 `frame_step: int = 1` 參數，傳給 `run_phalp(every_x_frame=frame_step)`
- [x] 8a.4 `gpu_worker.py`：`step1b_overlay` 的 fps 除以 `frame_step`，確保 overlay 播放速度正確
- [x] 8a.5 `task_manager.py`：`TaskState` 新增 `frame_step: int = 1`，加入 `to_persist_dict` / `from_persist_dict`
- [x] 8a.6 `upload.py`：接受 `frame_step: Optional[int] = Form(None)` 參數，存入 task
- [x] 8a.7 `gpu_worker.py`：`_process_detect` 傳 `frame_step=task.frame_step` 給 `step1_detect`
- [ ] 8a.8 `track_extractor.py`：`list_tracks_meta` 回傳的 `start_frame` 需乘以 `frame_step` 還原為實際幀號（或另加 `raw_start_frame` 欄位）— 暫不需要，frame_step 模式下 start_frame 直接除以 detection_fps 仍可用
- [x] 8a.9 `schemas.py`：`TracksResponse` 加入 `frame_step` 欄位
- [x] 8a.10 前端 `apiClient.ts`：`uploadVideo` 新增 `frameStep` 參數，TracksResponse 加 `frame_step`
- [x] 8a.11 前端 `page.tsx`：上傳區新增 frame step 選擇器（1 / 3 / 5），傳給 `uploadVideo`
- [x] 8a.12 前端 `page.tsx`：偵測完成後顯示「re-detect (full frames)」按鈕（stepOverride=1 重新上傳同一檔案）
- [x] 8a.13 `tests/test_api.py`：新增 frame_step 參數傳遞測試

**驗收：**
- `pytest` 全過
- 上傳時選快速模式（frame_step=5），偵測速度明顯加快
- overlay 播放速度與原始影片一致
- BVH 轉換 FPS 自動適配（`native_fps / frame_step`）
- 可切回精確模式重跑

**Phase 8b：SLERP 插值補幀（可選，8a 完成後再做）**

目標：對間隔取幀的 pose 資料做 quaternion SLERP 插值，補回原始幀率，提升動畫流暢度。

```
track_extractor 取出 N 幀 pose_aa (N, 24, 3)
    ↓
interpolation.py: axis-angle → quaternion → SLERP 補幀 → axis-angle
    ↓
輸出 N*frame_step 幀的 pose_aa，BVH 用原始 FPS 寫入
```

- [ ] 8b.1 新建 `backend/app/services/interpolation.py`：`interpolate_pose_aa(pose_aa, factor)` 函式，對每個 joint 做 quaternion SLERP 插值，補幀 `factor` 倍
- [ ] 8b.2 `pipeline.py`：`step2_convert` 在 smoothing 之前/之後可選呼叫 `interpolate_pose_aa`
- [ ] 8b.3 `schemas.py`：`ConvertRequest` 新增 `interpolate: bool = False` 欄位
- [ ] 8b.4 前端 `ConversionPanel.tsx`：新增「插值補幀」checkbox（僅在 frame_step > 1 時顯示）
- [ ] 8b.5 `tests/`：新增插值函式的單元測試（驗證幀數倍增、quaternion 正規化）

**驗收：**
- 間隔取幀 + 插值後的 VRMA 時長 = 原始影片時長
- 動畫比不插值明顯更平滑
- 快速動作的插值品質可接受（不出現嚴重扭曲）

---

### Phase 9：轉換計時、同步 playhead、歷史 load 完整功能

**目標：** 三項 UX 改進 — (1) 每個 task 顯示偵測/轉換耗時；(2) 轉換片段與 overlay 影片下方加同步 playhead；(3) 從 history load 已完成 task 時具備與首次轉換完全一致的操作功能。

**Phase 9a：轉換計時**

後端：TaskState 新增 4 個 datetime 欄位追蹤偵測/轉換的起止時間，gpu_worker 在狀態轉換點設定。
前端：HistoryPanel 顯示耗時，ProgressDisplay 即時顯示已耗時秒數。

- [x] 9a.1 `task_manager.py`：TaskState 新增 `detect_started_at`、`detect_finished_at`、`convert_started_at`、`convert_finished_at`（datetime | None），加入 `to_persist_dict` / `from_persist_dict`
- [x] 9a.2 `gpu_worker.py`：DETECTING 開始設 `detect_started_at`，TRACKS_READY 設 `detect_finished_at`，CONVERTING 設 `convert_started_at`，BVH_READY 設 `convert_finished_at`，ERROR 設對應 finished_at
- [x] 9a.3 `schemas.py`：HistoryItem / SharedTaskResponse 新增 `detect_elapsed_sec: float | None`、`convert_elapsed_sec: float | None`
- [x] 9a.4 `routers/history.py`：回傳時計算 `(finished - started).total_seconds()`
- [x] 9a.5 `apiClient.ts`：型別加 `detect_elapsed_sec` / `convert_elapsed_sec`
- [x] 9a.6 `HistoryPanel.tsx`：每筆記錄顯示耗時（如 "detect 45s | convert 3s"）
- [x] 9a.7 `ProgressDisplay.tsx`：轉換中即時顯示已耗時秒數（useEffect + interval）
- [x] 9a.8 `tests/test_api.py`：驗證時間欄位存在

**驗收：** 偵測/轉換完成後 history 正確顯示耗時；轉換中 ProgressDisplay 即時計時

**Phase 9b：同步 playhead**

新建精簡版 PlaybackBar 元件（薄型進度條 + 可點擊跳轉），放在 ReviewPanel 的影片和 overlay 面板下方。

- [x] 9b.1 新建 `components/PlaybackBar.tsx`：Props `duration`、`currentTime`、`onSeek?`，薄型橫條顯示已播放比例
- [x] 9b.2 `ReviewPanel.tsx`：新增 `overlayDuration`、`overlayCurrentTime` state，overlay 用 `onLoadedMetadata` 取 duration，tick loop 更新 currentTime
- [x] 9b.3 `ReviewPanel.tsx`：同步播放模式下影片面板加 `<PlaybackBar>`（duration = clipEnd-clipStart，currentTime = video.currentTime-clipStart）
- [x] 9b.4 `ReviewPanel.tsx`：overlay 面板加 `<PlaybackBar>`（duration = overlayDuration，currentTime = overlayCurrentTime）

**驗收：** 同步播放時兩個 playhead 同步移動，可點擊跳轉

**Phase 9c：history load 完整功能**

從 history load 已完成 task 時，操作行為與首次轉換完全一致：三面板同步播放、重選 track、重新轉換、下載、分享連結。

核心改動：持久化裁切資訊（clip_start_time / clip_end_time），load 時用後端 video URL 重建 clip，新增 `loadedStatus` 讓已完成 task 也能觸發 overlay URL 和 canConvert。

- [x] 9c.1 `task_manager.py`：TaskState 新增 `clip_start_time: float = 0.0`、`clip_end_time: float = 0.0`，加入 persist
- [x] 9c.2 `upload.py`：上傳時儲存 `task.clip_start_time` / `task.clip_end_time`（從 start_time / end_time Form 參數取得）
- [x] 9c.3 `schemas.py`：HistoryItem / SharedTaskResponse 新增 `clip_start_time`、`clip_end_time`
- [x] 9c.4 `routers/history.py`：回傳 clip_start_time / clip_end_time
- [x] 9c.5 `apiClient.ts`：型別更新，HistoryItem / SharedTask 加 clip time 欄位
- [x] 9c.6 `ReviewPanel.tsx`：`ClipInfo` 型別新增可選 `url?: string`（替代 File blob），`activeVideoSrc` 優先用 `clip.url`
- [x] 9c.7 `HistoryPanel.tsx`：`onLoadTask` callback 改為傳遞完整資訊（taskId, fileName, shareToken, clipStart, clipEnd）
- [x] 9c.8 `page.tsx`：新增 `loadedStatus` state，修改 `srcOverlayUrl` 和 `canConvert` 也看 `loadedStatus`
- [x] 9c.9 `page.tsx`：`onLoadTask` 完整恢復 — 設定 shareToken、用 video URL 建立 clipInfo、設定 loadedStatus、恢復 tracks/BVH/VRMA
- [x] 9c.10 `page.tsx`：load 後可重選 track、重新轉換（ConversionPanel 啟用）

**驗收：** 從 history load 任意已完成 task → 三面板同步播放（含 playhead）→ 可重選 track 重新轉換 → 下載 BVH/VRMA → 複製分享連結

---

## CLAUDE.md 概要

> 實際 CLAUDE.md 在專案根目錄，以下為概要摘錄。

- 後端：FastAPI (Python 3.12)，`conda run -n aicuda uvicorn app.main:app`
- 前端：Next.js 13.4 + TypeScript，`cd frontend && npm run dev`
- Pipeline：MP4 → PHALP (SMPL) → smpl2bvh (BVH) → [前端] bvh2vrma (VRMA)
- vendor/ 只讀，客製化在 services 層
- GPU 一次只處理一個任務（ThreadPoolExecutor max_workers=1）
- BVH → VRMA 在前端瀏覽器中執行
- 任務持久化：per-task JSON（`tmp/history/`），啟動時載入，7 天自動清理

---

## 風險與已知問題

| 風險 | 影響 | 緩解方式 |
|------|------|----------|
| PHALP Hydra config 繞過困難 | Phase 1 卡住 | 仔細讀 tracker.py 找最小進入點 |
| smpl2bvh 輸出骨架名與 bvh2vrma 預設不相容 | 前端映射失敗 | Phase 1 記錄實際輸出，Phase 2 加自訂映射 |
| bvh2vrma 轉換邏輯跟 UI 耦合 | 無法直接 import | 改用方式 B 參考原始碼重寫 |
| SMPL rest pose 不是 T-pose | 手臂角度偏移 | smpl_to_bvh_service 或前端加補償 |
| 長影片 GPU OOM | 處理失敗 | 分段處理影片 |
| 旋轉平滑 gimbal lock | 動畫異常 | quaternion slerp 替代 |
| three-vrm 套件版本衝突 | 執行錯誤 | 與 vendor/bvh2vrma 用同版本 |
| SMPL 學術授權 | 無法商用 | 聯繫 Meshcapade |
| 重啟遺失任務 | 體驗問題 | Phase 7 以 per-task JSON 持久化解決（7 天保留） |
