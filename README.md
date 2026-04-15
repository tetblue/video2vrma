# video2vrma

> 🎬 MP4 影片 → 人體動態捕捉 → VRMA 動畫格式
>
> MP4 video → Human Mocap → VRMA Animation
>
> MP4 動画 → 人体モーションキャプチャ → VRMA アニメーション

**🌐 Languages**: [繁體中文](#繁體中文) · [English](#english) · [日本語](#日本語)

---

## 繁體中文

### 📖 專案簡介

**video2vrma** 是一個將 MP4 影片轉換為 VRMA 動畫格式的端到端平台。你上傳一段人物動作影片，系統會自動偵測人物骨架、追蹤動作軌跡，並輸出可直接給 VRM 虛擬角色播放的 VRMA 動畫檔案。

### ✨ 關鍵功能

- **單人 / 多人偵測**：基於 PHALP + 4D-Humans 自動追蹤影片中所有人物並分配 track ID
- **互動式動作選擇**：偵測完成後可預覽骨架 overlay，勾選想要轉換的 track
- **裁切區段**：上傳前可用 range slider 指定起訖時間，只處理需要的片段
- **間隔取幀加速**：支援 `frame_step = 1 / 3 / 5` 三檔速度，可選擇搭配 SLERP 插值回補原始幀率
- **三面板同步預覽**：原始影片 / 骨架 overlay / VRM 動畫同時播放，雙向 playhead 拖拉
- **歷史記錄與分享**：無需登入即自動保留 7 天記錄（localStorage UUID 身份），每筆自動產生公開分享短連結
- **即時進度回報**：PHALP 偵測與骨架 overlay 渲染皆顯示真實百分比（不是假進度條）
- **系統狀態監控**：CPU / GPU / VRAM 使用率與排隊佇列（自己的任務會高亮）

### 🏗️ 使用的架構

```
┌────────────────────────┐   MP4       ┌──────────────────────┐
│  Next.js 13.4 (App dir)│────────────▶│ FastAPI + Uvicorn    │
│  React + TypeScript    │   WebSocket │ ThreadPoolExecutor   │
│  three.js + @pixiv/vrm │◀────────────│ (GPU worker, mw=1)   │
└────────────────────────┘   progress  └──────────┬───────────┘
                                                  │
                                                  ▼
                                     ┌────────────────────────┐
                                     │ PHALP (tracker)        │
                                     │  └─ 4D-Humans (SMPL)   │
                                     │     └─ detectron2 det  │
                                     │                        │
                                     │ pose_aa (N, 24, 3)     │
                                     │  └─ smoothing (S-G)    │
                                     │  └─ SLERP interpolate  │
                                     │  └─ smpl2bvh → BVH     │
                                     └────────────┬───────────┘
                                                  │ BVH text
                                                  ▼
                                     ┌────────────────────────┐
                                     │ 瀏覽器端 bvh2vrma       │
                                     │  (three.js + GLTFExp)  │
                                     │  → VRMA (glTF binary)  │
                                     └────────────────────────┘
```

- **後端**：FastAPI（Python 3.12）、PyTorch 2.7.1+cu128、CUDA 12.8；GPU 任務用 `ThreadPoolExecutor(max_workers=1)` 序列化避免 OOM
- **前端**：Next.js 13.4（app router）、TypeScript、three.js、@pixiv/three-vrm
- **持久化**：per-task JSON 寫到 `tmp/history/`，重啟後自動 reload；7 天過期自動清理
- **日誌**：`tmp/logs/backend.log` 滾動保存（5 MB × 3 份）
- **座標系修正**：PHALP 相機座標 → BVH → VRM 之間的 `diag(1, -1, -1)` 與 `rotation.y = π` 修正（見 `.claude/lessons/0006`）

### 💎 特色

- **vendor/ 只讀原則**：四個第三方專案 (4D-Humans / PHALP / smpl2bvh / bvh2vrma) 皆不修改，客製化都寫在 `services/` adapter 層，升級無痛
- **兩階段處理**：快速模式先掃描所有 track，選好再精確模式重跑，不浪費 GPU 時間
- **進度橋接**：sync PHALP `tqdm` 的 `update()` 被 monkey-patch 轉到 async `update_progress`，前端 WebSocket 看到的百分比是真的
- **空幀 defensive**：PHALP 在任何幀都可能沒偵測到人，所有索引 per-frame list 處都有 guard（見 lesson 0007 + 測試覆蓋）
- **Claude Code 工作流**：`.claude/` 目錄提供 hooks、slash commands、subagents、lessons，團隊共享統一規範

### 🚀 部署

本專案以**本機單人開發環境**為主要場景，不適合直接部署到公網。若需內網使用：

| 組件 | 建議配置 |
|---|---|
| OS | Windows 11 / Linux（主要在 Windows git bash 驗證） |
| GPU | NVIDIA CUDA 12.8、VRAM ≥ 12 GB（驗證於 RTX 5070 Ti Laptop, sm_120） |
| Python | 3.12（conda env `aicuda`） |
| Node.js | 18+ |
| 上傳上限 | 2 GB / 檔（可改 `backend/app/config.py` 的 `MAX_UPLOAD_BYTES`） |
| 儲存 | `tmp/` 與 `models/` 需本機儲存空間（模型 cache 約 6.4 GB） |

### 📦 安裝

#### 1. Clone 並進入專案

```bash
git clone https://github.com/lorenhsu1128/video2vrma.git
cd video2vrma
```

#### 2. Clone vendor 第三方專案

```bash
mkdir -p vendor
git clone https://github.com/brjathu/PHALP.git vendor/PHALP
git clone https://github.com/shubham-goel/4D-Humans.git vendor/4d-humans
git clone https://github.com/KosukeFukazawa/smpl2bvh.git vendor/smpl2bvh
git clone https://github.com/vrm-c/bvh2vrma.git vendor/bvh2vrma
```

實際 commit hash 可參考 `vendor-versions.txt`。

#### 3. 建立 conda 環境

```bash
conda create -n aicuda python=3.12 -y
conda activate aicuda

pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 \
  --index-url https://download.pytorch.org/whl/cu128

pip install fastapi uvicorn python-multipart websockets scipy \
  pytorch-lightning==1.9.5 hydra-core omegaconf transformers \
  opencv-python mediapipe pyrender trimesh chumpy yacs smplx \
  pynvml psutil joblib
```

#### 4. 下載 SMPL 模型

SMPL 受學術授權限制，**不會隨專案散佈**。請自行到 <https://smpl.is.tue.mpg.de/> 申請並下載，放入：

```
data/smpl/
├── SMPL_NEUTRAL.npz
├── basicmodel_f_lbs_10_207_0_v1.1.0.pkl
├── basicmodel_m_lbs_10_207_0_v1.1.0.pkl
└── basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl
```

#### 5. 前端依賴

```bash
cd frontend
npm install
cd ..
```

#### 6. 驗證環境

```bash
conda run -n aicuda python scripts/env_check.py
```

### 🎯 使用方式

#### 啟動服務

```bash
# 終端機 1：後端
cd backend
conda run -n aicuda uvicorn app.main:app --host 0.0.0.0 --port 8000

# 終端機 2：前端
cd frontend
npm run dev
```

瀏覽器開 <http://localhost:3000>。

#### 操作流程

1. **選檔** → 拖進或點擊選擇 `.mp4 / .mov / .avi / .mkv / .webm`（上限 2 GB）
2. **裁切**（可選）→ 用 range slider 指定起訖時間
3. **速度模式** → 選 frame_step：`1 (full)` / `3 (fast)` / `5 (faster)`
4. **Convert** → 後端 PHALP 偵測所有 track（進度即時回報）
5. **選 track** → 在 overlay 面板看到所有人物與 ID，點選要的 track
6. **BVH 轉換** → 選 fps / smoothing / interpolate 選項，後端輸出 BVH
7. **VRMA 下載** → 前端自動把 BVH 轉為 VRMA；三面板同步預覽
8. **分享** → 點「copy share link」複製 `/r/{token}` 公開頁連結

#### 開發用指令

若你用 Claude Code 開發，可以使用專案自帶的 slash commands：

| 指令 | 用途 |
|---|---|
| `/env-check` | 驗證 aicuda 環境與關鍵套件 |
| `/update-plan` | 依當前進度更新 `DEVELOPMENT_PLAN.md` |
| `/vendor-sync` | 重新產生 `vendor-versions.txt` |
| `/auto-feature <描述>` | 端到端自動開發一項功能，測試通過後 commit |

詳見 `WORKFLOW.md`。

### 📜 授權說明

#### 本專案

本專案的**原創程式碼**採 **MIT License** 授權。

#### 第三方元件

本專案透過 `vendor/` 目錄使用下列開源專案（皆為 MIT License，但各自有各自的 copyright 與引用要求）：

| 專案 | 授權 | Copyright | 連結 |
|---|---|---|---|
| **PHALP** | MIT | © 2022 University of California, Berkeley | [brjathu/PHALP](https://github.com/brjathu/PHALP) |
| **4D-Humans** | MIT | © 2023 UC Regents, Shubham Goel | [shubham-goel/4D-Humans](https://github.com/shubham-goel/4D-Humans) |
| **smpl2bvh** | MIT | © 2022 Konosuke | [KosukeFukazawa/smpl2bvh](https://github.com/KosukeFukazawa/smpl2bvh) |
| **bvh2vrma** | MIT | © 2023 VRM Consortium | [vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma) |

#### SMPL 模型（重要）

本專案**執行時**需要 SMPL body model。SMPL 並**非**本專案散佈，需由使用者自行依下列學術授權取得：

- **SMPL Model License**：<https://smpl.is.tue.mpg.de/modellicense.html>
- 限**非商業學術研究**使用，商業使用需另行洽談 Meshcapade GmbH

> ⚠️ 因此若你要做商業應用，**不能**直接使用本專案未經授權的 SMPL 模型檔案。

---

## English

### 📖 Overview

**video2vrma** is an end-to-end platform that converts MP4 videos into VRMA animation files. Upload a video of human motion, and the system automatically detects skeletons, tracks motion trajectories, and outputs VRMA animations that can be played directly on VRM avatars.

### ✨ Key Features

- **Single / multi-person detection**: Automatic tracking via PHALP + 4D-Humans with per-person track IDs
- **Interactive track selection**: Preview skeleton overlay after detection, pick the track to convert
- **Clip trimming**: Range-slider UI to trim start/end time before upload
- **Frame stepping acceleration**: `frame_step = 1 / 3 / 5` speed tiers, optionally paired with SLERP interpolation to restore native FPS
- **Three-panel synced preview**: Source video / skeleton overlay / VRM animation all play in sync with bidirectional playhead scrubbing
- **History & sharing**: No login required — 7-day auto-retention keyed by localStorage UUID, each task gets a public share short-link
- **Live progress**: Both PHALP detection and overlay rendering report real percentage (not fake progress bars)
- **System monitoring**: CPU / GPU / VRAM utilization and task queue (your own tasks highlighted)

### 🏗️ Architecture

```
┌────────────────────────┐   MP4       ┌──────────────────────┐
│  Next.js 13.4 (App dir)│────────────▶│ FastAPI + Uvicorn    │
│  React + TypeScript    │   WebSocket │ ThreadPoolExecutor   │
│  three.js + @pixiv/vrm │◀────────────│ (GPU worker, mw=1)   │
└────────────────────────┘   progress  └──────────┬───────────┘
                                                  │
                                                  ▼
                                     ┌────────────────────────┐
                                     │ PHALP (tracker)        │
                                     │  └─ 4D-Humans (SMPL)   │
                                     │     └─ detectron2 det  │
                                     │                        │
                                     │ pose_aa (N, 24, 3)     │
                                     │  └─ smoothing (S-G)    │
                                     │  └─ SLERP interpolate  │
                                     │  └─ smpl2bvh → BVH     │
                                     └────────────┬───────────┘
                                                  │ BVH text
                                                  ▼
                                     ┌────────────────────────┐
                                     │ Browser-side bvh2vrma  │
                                     │  (three.js + GLTFExp)  │
                                     │  → VRMA (glTF binary)  │
                                     └────────────────────────┘
```

- **Backend**: FastAPI (Python 3.12), PyTorch 2.7.1+cu128, CUDA 12.8; GPU tasks serialized via `ThreadPoolExecutor(max_workers=1)` to avoid OOM
- **Frontend**: Next.js 13.4 (app router), TypeScript, three.js, @pixiv/three-vrm
- **Persistence**: Per-task JSON in `tmp/history/`, auto-reloaded on startup; 7-day TTL with background cleanup
- **Logging**: `tmp/logs/backend.log` with rotation (5 MB × 3 files)
- **Coordinate fixes**: `diag(1, -1, -1)` between PHALP camera space and BVH, `rotation.y = π` for VRM (see `.claude/lessons/0006`)

### 💎 Highlights

- **vendor/ is read-only**: Four third-party projects (4D-Humans / PHALP / smpl2bvh / bvh2vrma) are never modified — all customization lives in the `services/` adapter layer for painless upstream updates
- **Two-stage processing**: Fast mode scans all tracks first; users select and re-run in precise mode to save GPU time
- **Sync→async progress bridge**: PHALP's `tqdm.update()` is monkey-patched to route into async `update_progress`, so WebSocket clients see real percentages
- **Defensive against empty frames**: PHALP can return empty detections on any frame — all per-frame list indexing sites are guarded (see lesson 0007 + regression tests)
- **Claude Code workflow**: `.claude/` directory ships hooks, slash commands, subagents, and lessons for consistent team development

### 🚀 Deployment

This project is primarily designed for **local single-user development**. It is not hardened for public internet deployment. For intranet use:

| Component | Recommended |
|---|---|
| OS | Windows 11 / Linux (primarily verified on Windows git bash) |
| GPU | NVIDIA CUDA 12.8, VRAM ≥ 12 GB (verified on RTX 5070 Ti Laptop, sm_120) |
| Python | 3.12 (conda env `aicuda`) |
| Node.js | 18+ |
| Upload limit | 2 GB per file (tune `MAX_UPLOAD_BYTES` in `backend/app/config.py`) |
| Storage | `tmp/` + `models/` need local disk (model cache ~6.4 GB) |

### 📦 Installation

#### 1. Clone the project

```bash
git clone https://github.com/lorenhsu1128/video2vrma.git
cd video2vrma
```

#### 2. Clone vendor projects

```bash
mkdir -p vendor
git clone https://github.com/brjathu/PHALP.git vendor/PHALP
git clone https://github.com/shubham-goel/4D-Humans.git vendor/4d-humans
git clone https://github.com/KosukeFukazawa/smpl2bvh.git vendor/smpl2bvh
git clone https://github.com/vrm-c/bvh2vrma.git vendor/bvh2vrma
```

Tested commit hashes are in `vendor-versions.txt`.

#### 3. Create conda environment

```bash
conda create -n aicuda python=3.12 -y
conda activate aicuda

pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 \
  --index-url https://download.pytorch.org/whl/cu128

pip install fastapi uvicorn python-multipart websockets scipy \
  pytorch-lightning==1.9.5 hydra-core omegaconf transformers \
  opencv-python mediapipe pyrender trimesh chumpy yacs smplx \
  pynvml psutil joblib
```

#### 4. Download SMPL model

SMPL is under academic license and **not redistributed** with this project. Register at <https://smpl.is.tue.mpg.de/> and place the files here:

```
data/smpl/
├── SMPL_NEUTRAL.npz
├── basicmodel_f_lbs_10_207_0_v1.1.0.pkl
├── basicmodel_m_lbs_10_207_0_v1.1.0.pkl
└── basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl
```

#### 5. Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

#### 6. Verify environment

```bash
conda run -n aicuda python scripts/env_check.py
```

### 🎯 Usage

#### Start services

```bash
# Terminal 1: backend
cd backend
conda run -n aicuda uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2: frontend
cd frontend
npm run dev
```

Open <http://localhost:3000>.

#### Workflow

1. **Select** → drop or click to choose `.mp4 / .mov / .avi / .mkv / .webm` (≤ 2 GB)
2. **Trim** (optional) → range slider for start/end time
3. **Speed mode** → pick `frame_step`: `1 (full)` / `3 (fast)` / `5 (faster)`
4. **Convert** → backend runs PHALP detection (live progress)
5. **Select track** → pick the person you want from the overlay panel
6. **BVH conversion** → choose fps / smoothing / interpolate options
7. **Download VRMA** → frontend converts BVH to VRMA; three-panel synced preview
8. **Share** → click "copy share link" for a public `/r/{token}` URL

#### Developer commands

If you develop with Claude Code, project-provided slash commands are available:

| Command | Purpose |
|---|---|
| `/env-check` | Verify aicuda environment & key packages |
| `/update-plan` | Update `DEVELOPMENT_PLAN.md` checkboxes |
| `/vendor-sync` | Regenerate `vendor-versions.txt` |
| `/auto-feature <desc>` | End-to-end feature development with auto-commit |

See `WORKFLOW.md` for details.

### 📜 License

#### This Project

The **original code** in this repository is licensed under **MIT License**.

#### Third-Party Components

Code under `vendor/` is from open-source projects, all MIT-licensed but with their own copyrights:

| Project | License | Copyright | Link |
|---|---|---|---|
| **PHALP** | MIT | © 2022 University of California, Berkeley | [brjathu/PHALP](https://github.com/brjathu/PHALP) |
| **4D-Humans** | MIT | © 2023 UC Regents, Shubham Goel | [shubham-goel/4D-Humans](https://github.com/shubham-goel/4D-Humans) |
| **smpl2bvh** | MIT | © 2022 Konosuke | [KosukeFukazawa/smpl2bvh](https://github.com/KosukeFukazawa/smpl2bvh) |
| **bvh2vrma** | MIT | © 2023 VRM Consortium | [vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma) |

#### SMPL Model (Important)

This project **requires** the SMPL body model at runtime. SMPL is **not** redistributed here; users must obtain it under:

- **SMPL Model License**: <https://smpl.is.tue.mpg.de/modellicense.html>
- Limited to **non-commercial academic research**; commercial use requires a separate license from Meshcapade GmbH.

> ⚠️ For commercial use, you must negotiate a commercial SMPL license independently.

---

## 日本語

### 📖 プロジェクト概要

**video2vrma** は、MP4 動画を VRMA アニメーションファイルに変換するエンドツーエンドのプラットフォームです。人物の動きを含む動画をアップロードすると、システムが自動的に骨格を検出し、動きの軌跡を追跡して、VRM アバターで直接再生できる VRMA アニメーションを出力します。

### ✨ 主な機能

- **単一 / 複数人物検出**：PHALP + 4D-Humans による動画内の全人物の自動追跡（トラック ID 付与）
- **インタラクティブなトラック選択**：検出完了後、骨格オーバーレイで確認してから変換するトラックを選択
- **クリップトリミング**：アップロード前にレンジスライダーで開始・終了時刻を指定可能
- **フレームスキップ高速化**：`frame_step = 1 / 3 / 5` の 3 段階、SLERP 補間でネイティブ FPS への復元もオプション
- **3 面同期プレビュー**：元動画 / 骨格オーバーレイ / VRM アニメーションを同時再生、双方向 playhead ドラッグ対応
- **履歴と共有**：ログイン不要 — localStorage UUID をキーに 7 日間自動保持、各タスクに公開共有短縮 URL 自動生成
- **リアルタイム進捗**：PHALP 検出とオーバーレイ描画の両方で実際の進捗パーセンテージを表示
- **システム状態モニタリング**：CPU / GPU / VRAM 使用率と待機キュー（自分のタスクはハイライト）

### 🏗️ アーキテクチャ

```
┌────────────────────────┐   MP4       ┌──────────────────────┐
│  Next.js 13.4 (App dir)│────────────▶│ FastAPI + Uvicorn    │
│  React + TypeScript    │   WebSocket │ ThreadPoolExecutor   │
│  three.js + @pixiv/vrm │◀────────────│ (GPU worker, mw=1)   │
└────────────────────────┘   progress  └──────────┬───────────┘
                                                  │
                                                  ▼
                                     ┌────────────────────────┐
                                     │ PHALP (tracker)        │
                                     │  └─ 4D-Humans (SMPL)   │
                                     │     └─ detectron2 det  │
                                     │                        │
                                     │ pose_aa (N, 24, 3)     │
                                     │  └─ smoothing (S-G)    │
                                     │  └─ SLERP interpolate  │
                                     │  └─ smpl2bvh → BVH     │
                                     └────────────┬───────────┘
                                                  │ BVH text
                                                  ▼
                                     ┌────────────────────────┐
                                     │ ブラウザ側 bvh2vrma     │
                                     │  (three.js + GLTFExp)  │
                                     │  → VRMA (glTF binary)  │
                                     └────────────────────────┘
```

- **バックエンド**：FastAPI (Python 3.12)、PyTorch 2.7.1+cu128、CUDA 12.8；GPU タスクは OOM 回避のため `ThreadPoolExecutor(max_workers=1)` で直列化
- **フロントエンド**：Next.js 13.4 (app router)、TypeScript、three.js、@pixiv/three-vrm
- **永続化**：タスク単位の JSON を `tmp/history/` に保存、起動時に自動ロード；7 日間 TTL で自動クリーンアップ
- **ログ**：`tmp/logs/backend.log` にローテーション保存（5 MB × 3 世代）
- **座標系補正**：PHALP カメラ座標 → BVH → VRM 間の `diag(1, -1, -1)` と `rotation.y = π` 補正（`.claude/lessons/0006` 参照）

### 💎 特色

- **vendor/ 読み取り専用原則**：4 つの第三者プロジェクト (4D-Humans / PHALP / smpl2bvh / bvh2vrma) は一切変更せず、カスタマイズは全て `services/` アダプター層で実装 — アップストリーム更新が容易
- **2 段階処理**：高速モードで先に全トラックをスキャンし、選択後に精密モードで再実行して GPU 時間を節約
- **sync → async 進捗ブリッジ**：PHALP の `tqdm.update()` を monkey-patch で非同期 `update_progress` に接続、WebSocket クライアントが見るのは真の進捗
- **空フレーム防御**：PHALP はどのフレームでも人物を検出できない可能性があり、per-frame リストのインデックス箇所は全て guard 済み（lesson 0007 とリグレッションテスト参照）
- **Claude Code ワークフロー**：`.claude/` ディレクトリに hooks、slash commands、subagents、lessons を同梱 — チームで一貫した開発規約を共有

### 🚀 デプロイ

本プロジェクトは**ローカルシングルユーザー開発環境**を主な想定シーンとしており、パブリックインターネットへの直接デプロイには向いていません。イントラネット用途の場合：

| 構成要素 | 推奨 |
|---|---|
| OS | Windows 11 / Linux（主に Windows git bash で検証済み） |
| GPU | NVIDIA CUDA 12.8、VRAM 12 GB 以上（RTX 5070 Ti Laptop, sm_120 で検証済み） |
| Python | 3.12（conda env `aicuda`） |
| Node.js | 18+ |
| アップロード上限 | 2 GB/ファイル（`backend/app/config.py` の `MAX_UPLOAD_BYTES` で調整可能） |
| ストレージ | `tmp/` と `models/` にローカル容量が必要（モデルキャッシュ約 6.4 GB） |

### 📦 インストール

#### 1. プロジェクトを clone

```bash
git clone https://github.com/lorenhsu1128/video2vrma.git
cd video2vrma
```

#### 2. vendor プロジェクトを clone

```bash
mkdir -p vendor
git clone https://github.com/brjathu/PHALP.git vendor/PHALP
git clone https://github.com/shubham-goel/4D-Humans.git vendor/4d-humans
git clone https://github.com/KosukeFukazawa/smpl2bvh.git vendor/smpl2bvh
git clone https://github.com/vrm-c/bvh2vrma.git vendor/bvh2vrma
```

検証済みの commit hash は `vendor-versions.txt` を参照。

#### 3. conda 環境を作成

```bash
conda create -n aicuda python=3.12 -y
conda activate aicuda

pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 \
  --index-url https://download.pytorch.org/whl/cu128

pip install fastapi uvicorn python-multipart websockets scipy \
  pytorch-lightning==1.9.5 hydra-core omegaconf transformers \
  opencv-python mediapipe pyrender trimesh chumpy yacs smplx \
  pynvml psutil joblib
```

#### 4. SMPL モデルをダウンロード

SMPL は学術ライセンスの制約により、**本プロジェクトでは配布しません**。<https://smpl.is.tue.mpg.de/> で申請・ダウンロードし、以下に配置してください：

```
data/smpl/
├── SMPL_NEUTRAL.npz
├── basicmodel_f_lbs_10_207_0_v1.1.0.pkl
├── basicmodel_m_lbs_10_207_0_v1.1.0.pkl
└── basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl
```

#### 5. フロントエンド依存関係

```bash
cd frontend
npm install
cd ..
```

#### 6. 環境を検証

```bash
conda run -n aicuda python scripts/env_check.py
```

### 🎯 使い方

#### サービス起動

```bash
# ターミナル 1：バックエンド
cd backend
conda run -n aicuda uvicorn app.main:app --host 0.0.0.0 --port 8000

# ターミナル 2：フロントエンド
cd frontend
npm run dev
```

ブラウザで <http://localhost:3000> を開く。

#### 操作フロー

1. **ファイル選択** → `.mp4 / .mov / .avi / .mkv / .webm` をドロップまたはクリック選択（2 GB 以下）
2. **トリミング**（オプション）→ レンジスライダーで開始・終了時刻を指定
3. **速度モード** → `frame_step` を選択：`1 (full)` / `3 (fast)` / `5 (faster)`
4. **Convert** → バックエンドで PHALP が全トラックを検出（進捗リアルタイム表示）
5. **トラック選択** → オーバーレイ画面で人物と ID を確認、変換したいトラックを選択
6. **BVH 変換** → fps / smoothing / interpolate オプションを選び、BVH を出力
7. **VRMA ダウンロード** → フロントエンドが自動的に BVH を VRMA に変換；3 面同期プレビュー
8. **共有** → 「copy share link」で `/r/{token}` の公開 URL をコピー

#### 開発用コマンド

Claude Code で開発する場合、プロジェクト同梱の slash commands が使えます：

| コマンド | 用途 |
|---|---|
| `/env-check` | aicuda 環境と主要パッケージを検証 |
| `/update-plan` | `DEVELOPMENT_PLAN.md` のチェックボックスを更新 |
| `/vendor-sync` | `vendor-versions.txt` を再生成 |
| `/auto-feature <説明>` | 機能を自動開発し、テスト通過後に commit |

詳細は `WORKFLOW.md` を参照。

### 📜 ライセンス

#### 本プロジェクト

このリポジトリの**オリジナルコード**は **MIT License** のもとで提供されます。

#### 第三者コンポーネント

`vendor/` 以下のコードは全てオープンソース (MIT License) ですが、各プロジェクトの copyright と引用要件が適用されます：

| プロジェクト | ライセンス | 著作権 | リンク |
|---|---|---|---|
| **PHALP** | MIT | © 2022 University of California, Berkeley | [brjathu/PHALP](https://github.com/brjathu/PHALP) |
| **4D-Humans** | MIT | © 2023 UC Regents, Shubham Goel | [shubham-goel/4D-Humans](https://github.com/shubham-goel/4D-Humans) |
| **smpl2bvh** | MIT | © 2022 Konosuke | [KosukeFukazawa/smpl2bvh](https://github.com/KosukeFukazawa/smpl2bvh) |
| **bvh2vrma** | MIT | © 2023 VRM Consortium | [vrm-c/bvh2vrma](https://github.com/vrm-c/bvh2vrma) |

#### SMPL モデル（重要）

本プロジェクトは**実行時に**SMPL body model を必要とします。SMPL は本プロジェクトで配布されておらず、以下のライセンスのもとで各自取得する必要があります：

- **SMPL Model License**：<https://smpl.is.tue.mpg.de/modellicense.html>
- **非商用の学術研究目的**に限定；商用利用は Meshcapade GmbH との個別契約が必要です。

> ⚠️ 商用アプリケーションとして利用する場合、商用 SMPL ライセンスを別途取得する必要があります。

---

## 🔗 Related Docs / 関連ドキュメント / 相關文件

- [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) — 詳細な開発計画と進捗 / detailed development plan
- [`WORKFLOW.md`](./WORKFLOW.md) — Claude Code 作業規範 / workflow guide
- [`CLAUDE.md`](./CLAUDE.md) — AI 協作規範 / AI collaboration rules
- [`.claude/lessons/`](./.claude/lessons/) — 開發教訓集 / development lessons
