# CLAUDE.md

Claude Code 每次對話開始時會自動載入本檔案。這是 video2vrma 專案的最高優先規範。

## 專案簡介

video2vrma：MP4 影片 → 人體動態捕捉 → VRMA 動畫格式。後端 FastAPI + Python (PHALP/4D-Humans/smpl2bvh)，前端 Next.js + TypeScript (bvh2vrma)。

詳細架構見 `DEVELOPMENT_PLAN.md`。

## 開發環境（鐵則）

- **永遠使用 conda env `aicuda`**：所有 Python 指令必須透過 `conda run -n aicuda ...` 或先 activate，**絕不**在 base 環境跑 `python` / `pip`。
- **Shell 是 Windows git bash**：用 `/dev/null` 而非 `NUL`，路徑用正斜線，不要用 PowerShell / cmd 語法。
- **Python 3.12.11 + torch 2.7.1+cu128 + CUDA 12.8**（硬體 RTX 5070 Ti Laptop, sm_120）。

## 核心規則

1. **`vendor/` 只讀**：4d-humans、PHALP、smpl2bvh、bvh2vrma 的原始碼不得修改。任何客製化寫在 `backend/app/services/` 或 `frontend/src/services/` 的 adapter 層。
2. **`data/smpl/` 有授權**：不進 git、不貼內容到對話、不覆寫。
3. **GPU 測試慎跑**：單一任務耗數十秒~數分鐘，不要在無關修改後反射性跑 e2e；先用最小重現案例。
4. **NumPy 2.x 相容性**：遇到 `np.float` / `np.int` 等已移除 API，優先 patch 呼叫端，不要降版 NumPy。
5. **根因優先**：不用 try/except 吞錯誤，不用 `--no-verify` 繞過 hooks，不用 `git reset --hard` 除非使用者明說。
6. **PHALP→BVH→VRM pipeline 座標系** (lesson 0006)：PHALP `global_orient` 是相機座標 (Y down, Z fwd)，寫進 BVH 前要 `diag(1,-1,-1)` 轉；前端 `vrm.scene.rotation.y = Math.PI` 讓角色面對相機；bvh2vrma 的 hips position track 會把 VRM hips 拉到原點必須拿掉但 auto-grounding 要保留；VRM 載入後要用 React state 不只用 ref，`vrm.update(dt)` 必須每 frame 呼叫。

## 開發工作流程

### A. 完成功能後必須做的事（自動文件同步）

每次完成一個可驗收的功能單元後，Claude **必須主動**檢查並更新：

1. **`DEVELOPMENT_PLAN.md`**：對應 Phase 的任務勾選 `[x]`，若範圍變動則增減任務條目
2. **`CLAUDE.md`**（本檔案）：若新增了模組、API、目錄、環境依賴，同步更新「目錄結構」或相關段落
3. **`vendor-versions.txt`**：若 vendor/ 有更新，執行 `/vendor-sync`

可以用 `/update-plan` 指令讓更新動作更明確。`.claude/hooks/remind-update-docs.sh` 會在編輯 `backend/`、`frontend/` 後提醒你確認此事。

**Commit message 語言**：一律用**繁體中文**撰寫（不是簡體、不是英文）。簡述「做了什麼」與「為什麼」，技術名詞可保留英文原文。範例：
- ✅ `新增 PHALP adapter，修正 NumPy 2.x 的 np.float 相容性問題`
- ❌ `add phalp adapter` / `添加 phalp 适配器`

### B. 被使用者糾正時必須做的事（錯誤記憶機制）

當使用者糾正一個 AI 犯的錯誤時，先判斷：

- **系統性錯誤**（會重犯、非顯而易見、有明確根因）→ **立即寫 lesson**
- **一次性筆誤**（typo、誤讀訊息）→ 改正即可

**寫 lesson 流程**（或直接用 `/save-lesson` 指令）：

1. 讀 `.claude/lessons/INDEX.md` 找下一個編號 `NNNN`
2. 複製 `.claude/lessons/TEMPLATE.md` 的格式，建立 `.claude/lessons/NNNN-slug.md`
3. 填入四個段落：錯誤是什麼 / 為什麼犯 / 未來如何避免 / 如何判斷適用
4. 在 `.claude/lessons/INDEX.md` 加一行索引

下次對話開始時，INDEX.md 會透過下方 `@import` 自動載入 context，避免重犯。

@.claude/lessons/INDEX.md

## 目錄結構

```
video2vrma/
├── CLAUDE.md                  本檔案（對話自動載入）
├── WORKFLOW.md                使用說明（人類看的）
├── DEVELOPMENT_PLAN.md        開發計畫（隨進度更新）
├── vendor-versions.txt        vendor/ 各子專案 commit hash
├── .claude/
│   ├── settings.json          hooks + 權限設定
│   ├── hooks/                 自動守則腳本（bash）
│   ├── commands/              slash commands 定義
│   ├── agents/                subagent 定義
│   └── lessons/               歷史教訓（INDEX.md 自動載入）
├── scripts/
│   └── env_check.py           環境檢查腳本
├── vendor/                    第三方專案（只讀）
│   ├── 4d-humans/
│   ├── PHALP/
│   ├── smpl2bvh/
│   └── bvh2vrma/
├── data/
│   └── smpl/                  SMPL 模型（不進 git）
├── models/                    本機模型 cache（不進 git，~6.4 GB）
│   ├── _home/.cache/phalp/    PHALP 權重 + SMPL_NEUTRAL（env HOME 指向這裡）
│   ├── _home/.cache/4DHumans/ 4D-Humans hmr2 checkpoint + configs
│   └── iopath_cache/detectron2/ ViTDet + mask_rcnn 權重（env FVCORE_CACHE）
├── backend/                   FastAPI
│   ├── app/
│   │   ├── main.py            create_app + lifespan + lazy `app` 屬性
│   │   ├── config.py          路徑常數 + 預設參數（FPS / end_frame / smoothing）
│   │   ├── core/
│   │   │   ├── task_manager.py  TaskState + TaskStep + queue + WS subscribers
│   │   │   └── gpu_worker.py    背景 worker：detect 走 queue，convert 由路由直呼
│   │   ├── models/schemas.py  Pydantic request/response
│   │   ├── routers/
│   │   │   ├── upload.py       POST /api/upload
│   │   │   ├── tasks.py        GET status/tracks/download/video/overlay + POST convert + WS
│   │   │   └── system.py       GET /api/system/stats（CPU / GPU / 佇列）
│   │   └── services/          pipeline adapter 層
│   │       ├── vendor_paths.py        HOME / FVCORE_CACHE override + stub / patch
│   │       ├── phalp_service.py       PHALP tracker 包裝
│   │       ├── track_extractor.py     PHALP pkl → pose_aa (n,24,3)，cam→VRM 翻轉
│   │       ├── smoothing.py           Savitzky-Golay 平滑（rotmat 空間 + SVD 投影）
│   │       ├── smpl_to_bvh_service.py pose_aa → BVH via smpl2bvh
│   │       ├── preview.py             骨架 3D GIF + 2D overlay mp4（多 track 彩色 + ID 標籤）
│   │       └── pipeline.py            run_e2e + step1_detect/step2_convert
│   ├── scripts/test_e2e.py    端到端 CLI
│   ├── pytest.ini             asyncio_mode=auto
│   └── tests/                 pytest 單元測試（含 FastAPI TestClient + stub pipeline）
├── frontend/                  Next.js 13.4 (app router)
│   ├── src/app/page.tsx       Phase 5 完整流程頁：upload → progress → tracks → convert → preview
│   ├── src/components/
│   │   ├── VideoUploader.tsx       檔案選擇（不自動上傳）
│   │   │   ├── VideoTrimmer.tsx       影片預覽 + 時間段 slider + 開始轉換
│   │   ├── ProgressDisplay.tsx     5 階段步驟條 + progress bar
│   │   ├── TrackSelector.tsx       PHALP track 選擇
│   │   ├── ConversionPanel.tsx     fps + smoothing + 觸發 convert
│   │   ├── VrmPreview.tsx          three + @pixiv/three-vrm 預覽器
│   │   ├── ReviewPanel.tsx         三欄同步預覽（原始影片 / overlay / VRM）
│   │   └── SystemStats.tsx         CPU / GPU / 佇列即時監控
│   ├── src/hooks/useTaskProgress.ts  WebSocket 訂閱 /api/ws/tasks/{id}
│   ├── src/services/
│   │   ├── apiClient.ts            fetch wrapper（NEXT_PUBLIC_API_BASE）
│   │   └── bvhToVrma.ts            bvhText → vrma blob adapter
│   ├── src/lib/bvh2vrma/      vendor/bvh2vrma/src/lib/bvh-converter 5 檔 copy
│   └── public/models/default.vrm  預設 VRM 模型
└── tmp/                       暫存（不進 git）
```

## 常用指令

| 指令 | 用途 |
|---|---|
| `/env-check` | 檢查 aicuda 環境與關鍵套件 |
| `/update-plan` | 依當前進度更新 DEVELOPMENT_PLAN.md |
| `/vendor-sync` | 重新產生 vendor-versions.txt |
| `/new-phase` | 進入下個 Phase 的 checklist |
| `/save-lesson` | 記錄一條新 lesson |
| `/auto-feature` | 端到端自動開發一項功能，測試通過後自動 commit |

## 禁止事項

- 不用 `--no-verify` 繞過 pre-commit hooks
- 不用 `git reset --hard` / `git push --force` 除非使用者明說
- 不跑 `pip install` 到 base 環境
- 不在對話中貼出 `data/smpl/` 的檔案內容
- 不修改 `vendor/` 下的任何檔案
- 不在 `conda run ... python -c` 使用含換行的字串（conda 不支援，見 lesson 0001）
