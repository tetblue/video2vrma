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
| 任務狀態 | 記憶體內 dict (無外部依賴) |
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
├── vendor-versions.txt
├── .gitignore
│
├── vendor/                        # 第三方依賴 (全部本地 clone)
│   ├── 4D-Humans/                 # Python — 後端 import
│   ├── PHALP/                     # Python — 後端 import
│   ├── smpl2bvh/                  # Python — 後端 import
│   └── bvh2vrma/                  # TypeScript — 前端參考原始碼
│
├── data/
│   └── smpl/
│       └── basicModel_neutral_lbs_10_207_0_v1.0.0.pkl
│
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── upload.py
│   │   │   └── tasks.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── pipeline.py
│   │   │   ├── phalp_service.py
│   │   │   ├── smpl_to_bvh_service.py
│   │   │   ├── smoothing.py
│   │   │   └── track_extractor.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── task_manager.py
│   │   │   └── gpu_worker.py
│   │   └── models/
│   │       ├── __init__.py
│   │       └── schemas.py
│   ├── tests/
│   ├── scripts/
│   │   └── test_e2e.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── VideoUploader.tsx
│   │   │   ├── TrackSelector.tsx
│   │   │   ├── ProgressDisplay.tsx
│   │   │   ├── ConversionPanel.tsx
│   │   │   └── VrmPreview.tsx
│   │   ├── services/
│   │   │   ├── apiClient.ts
│   │   │   ├── bvhToVrma.ts       # 核心：從 vendor/bvh2vrma 提取/參考
│   │   │   └── vrmaExporter.ts
│   │   ├── hooks/
│   │   │   ├── useTaskProgress.ts
│   │   │   └── useVrmAnimation.ts
│   │   └── types/
│   │       └── index.ts
│   ├── public/
│   │   └── models/
│   │       └── default.vrm
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.js
│
└── tmp/
    ├── uploads/
    └── outputs/
```

---

## API 規格

### REST API

| 端點 | 方法 | 功能 | 請求/回應 |
|------|------|------|-----------|
| `/api/upload` | POST | 上傳 MP4 | multipart/form-data → `{ task_id }` |
| `/api/tasks/{task_id}/status` | GET | 查詢任務狀態 | → `{ status, progress, step, message, error? }` |
| `/api/tasks/{task_id}/tracks` | GET | 取得人物列表 | → `{ tracks: [{ id, thumbnail_base64, frame_count }] }` |
| `/api/tasks/{task_id}/convert` | POST | 指定 track 轉 BVH | `{ track_id, fps?, smooth? }` → `{ status }` |
| `/api/tasks/{task_id}/download/bvh` | GET | 下載 BVH | → BVH 檔案 |

### WebSocket

| 端點 | 功能 |
|------|------|
| `/ws/tasks/{task_id}` | 即時推送處理進度 |

### 任務狀態機

```
QUEUED → DETECTING → TRACKS_READY → (等使用者選 track)
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
├── DEVELOPMENT_PLAN.md        ✅ 已存在（本檔案）
├── README.md                  ✅ 存在（僅一行）
├── .git/                      ✅ git 已初始化，主分支 main
├── data/
│   └── smpl/                  ✅ 已放入 SMPL 模型
│       ├── SMPL_NEUTRAL.npz
│       ├── basicmodel_f_lbs_10_207_0_v1.1.0.pkl
│       ├── basicmodel_m_lbs_10_207_0_v1.1.0.pkl
│       └── basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl
├── vendor/                    ✅ 四個第三方專案已 clone
│   ├── 4d-humans/             ✅ hmr2, demo.py, track.py 等齊全
│   ├── PHALP/                 ✅ phalp/, scripts/
│   ├── smpl2bvh/              ✅ smpl2bvh.py, utils/
│   └── bvh2vrma/              ✅ Next.js 13.4 + three 0.153 + @pixiv/three-vrm 2.1
│                                  src/: features/vrmViewer, lib/VRMAnimation, lib/bvh-converter,
│                                        pages, components, utils, types, styles
│
├── backend/                   ❌ 尚未建立
├── frontend/                  ❌ 尚未建立
├── tmp/                       ❌ 尚未建立
├── CLAUDE.md                  ❌ 尚未建立
├── vendor-versions.txt        ❌ 尚未建立
└── .gitignore                 ❌ 尚未建立
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

- [ ] 1.1 準備 5-10 秒測試影片
- [ ] 1.2 研讀 PHALP 原始碼，找最小初始化路徑
- [ ] 1.3 撰寫 backend/scripts/test_e2e.py
- [ ] 1.4 驗證 PHALP 輸出 pkl 結構
- [ ] 1.5 研讀 smpl2bvh 原始碼，確認輸入輸出格式
- [ ] 1.6 處理 PHALP → smpl2bvh 格式銜接
- [ ] 1.7 用 Blender 驗證 BVH，**記錄實際骨架命名**（Phase 2 會用到）

**驗收：** test_e2e.py 跑通，BVH 在 Blender 中動畫合理

---

### Phase 2：前端 BVH → VRMA 驗證

**目標：** 瀏覽器中 BVH → VRMA → VRM 預覽。

**任務：**

- [ ] 2.1 研讀 vendor/bvh2vrma/src/ 原始碼
  - 找到核心轉換函式入口
  - 理解骨架映射邏輯
  - 理解 VRMA glTF 組裝方式
  - 確認它依賴的 npm 套件和版本
- [ ] 2.2 確認 bvh2vrma 預設支援的 BVH 骨架格式
  - 跟 Phase 1 記錄的 smpl2bvh 實際輸出骨架名比對
  - 如果不相容，記錄需要自訂映射的地方
- [ ] 2.3 決定整合方式（方式 A 直接 import 或方式 B 提取重寫）
- [ ] 2.4 實作 frontend/src/services/bvhToVrma.ts
  - 整合 bvh2vrma 核心邏輯
  - 加入 SMPL 骨架名映射（如果需要）
- [ ] 2.5 建前端測試頁面（純前端，手動載入 Phase 1 的 BVH）
- [ ] 2.6 實作 VrmPreview.tsx
- [ ] 2.7 驗證動畫品質
  - 手腳交叉 → 骨架映射錯誤
  - 鏡像 → 左右反轉
  - 手臂偏移 → rest pose 補償問題
- [ ] 2.8 準備預設 VRM 模型

**驗收：** 瀏覽器中播放 VRMA 動畫正常，可下載 VRMA

---

### Phase 3：後端 Service 層封裝

**目標：** 測試腳本拆成正式 service 模組。

- [ ] 3.1 config.py
- [ ] 3.2 phalp_service.py
- [ ] 3.3 track_extractor.py
- [ ] 3.4 smoothing.py
- [ ] 3.5 smpl_to_bvh_service.py
- [ ] 3.6 pipeline.py
- [ ] 3.7 單元測試

**驗收：** pipeline 測試通過

---

### Phase 4：後端 API 與任務管理

**目標：** FastAPI + 記憶體內任務佇列，一個指令啟動。

- [ ] 4.1 task_manager.py
- [ ] 4.2 gpu_worker.py
- [ ] 4.3 main.py (lifespan + uvicorn)
- [ ] 4.4 schemas.py
- [ ] 4.5 upload.py router
- [ ] 4.6 tasks.py router (含 WebSocket)
- [ ] 4.7 API 測試

**驗收：** `python -m app.main` 啟動，curl 走完流程

---

### Phase 5：前端 UI 開發

- [ ] 5.1 VideoUploader.tsx
- [ ] 5.2 apiClient.ts
- [ ] 5.3 useTaskProgress.ts (WebSocket)
- [ ] 5.4 ProgressDisplay.tsx
- [ ] 5.5 TrackSelector.tsx
- [ ] 5.6 ConversionPanel.tsx
- [ ] 5.7 整合 VrmPreview.tsx
- [ ] 5.8 頁面佈局和 UX

**驗收：** 完整使用者流程可走通

---

### Phase 6：優化與錯誤處理

- [ ] 6.1 錯誤處理
- [ ] 6.2 Web Worker (bvhToVrma)
- [ ] 6.3 效能優化
- [ ] 6.4 輸入驗證
- [ ] 6.5 日誌
- [ ] 6.6 佇列狀態顯示

---

## CLAUDE.md

```markdown
# CLAUDE.md

## 專案簡介

video2vrma：MP4 影片 → 人體動態捕捉 → VRMA 動畫格式的轉換平台。

## 架構

- 後端：FastAPI (Python 3.10)，一個指令啟動，不需要 Redis/Celery
- 前端：Next.js + TypeScript
- 第三方依賴：vendor/ 下全部本地 clone，直接 import 或參考原始碼，不使用 CLI
- 任務管理：記憶體內 asyncio.Queue + ThreadPoolExecutor

## 轉換 Pipeline

MP4 → PHALP (SMPL) → smpl2bvh (BVH) → [回傳前端] → bvh2vrma (VRMA)

## 啟動方式

後端：cd backend && python -m app.main
前端：cd frontend && npm run dev
不需要啟動任何額外服務。

## 目錄慣例

- vendor/：第三方專案，不修改原始碼
  - vendor/4D-Humans, vendor/PHALP, vendor/smpl2bvh → 後端 Python import
  - vendor/bvh2vrma → 前端參考其 TypeScript 轉換邏輯
- backend/app/core/：任務管理 (task_manager.py)、GPU worker (gpu_worker.py)
- backend/app/services/：核心業務邏輯
- backend/app/routers/：API 端點
- frontend/src/services/：前端核心邏輯
  - bvhToVrma.ts：BVH→VRMA 轉換，邏輯來自 vendor/bvh2vrma
- frontend/src/components/：React 元件
- data/smpl/：SMPL 模型檔案 (不進 git)
- tmp/：暫存檔案 (不進 git)

## 後端任務管理

不使用 Redis/Celery。改用：
- TaskManager：記憶體內 dict 管理任務狀態
- asyncio.Queue：任務排隊
- ThreadPoolExecutor(max_workers=1)：GPU 任務在背景線程執行
- 進度透過 asyncio.run_coroutine_threadsafe 從 GPU 線程回報到 event loop
- WebSocket 從 event loop 推送給前端

## 程式碼風格

- Python：type hints，docstring 用中文
- TypeScript：strict mode，所有函式有型別標注
- 不靜默吞例外，記 log 後向上拋出

## 重要注意事項

1. vendor/ 不修改原始碼，需客製化時：
   - Python 專案：在 backend/app/services/ 封裝
   - bvh2vrma：在 frontend/src/services/bvhToVrma.ts 中整合或重寫
2. PHALP 用 Hydra config，用 OmegaConf.create() 繞過 CLI
3. GPU 一次只處理一個任務 (ThreadPoolExecutor max_workers=1)
4. SMPL 模型有授權限制，不進 git
5. BVH → VRMA 在前端瀏覽器中執行，後端不處理 VRMA
6. smpl2bvh 輸出的骨架命名要跟前端 SMPL_TO_VRM_BONE_MAP 一致
7. 服務重啟時任務狀態會遺失（記憶體內），使用者重新上傳即可
8. bvh2vrma 的 npm 套件版本盡量與我們的 frontend 一致，避免 API 不相容
```

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
| 重啟遺失任務 | 體驗問題 | 可接受；未來可加 SQLite |
