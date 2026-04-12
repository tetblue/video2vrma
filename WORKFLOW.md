# video2vrma — Claude Code 開發工作規範與流程

本檔案是 video2vrma 專案搭配 Claude Code 開發的**使用說明與規範**。
解壓縮或 clone 之後，依照下列步驟即可直接上手。

> 💡 本檔案是給**人類**看的。Claude 會自動讀 `CLAUDE.md` 與 `.claude/lessons/INDEX.md`，
> 不需要另外餵這份文件。

---

## 目錄

1. [前置需求](#1-前置需求)
2. [初次設定](#2-初次設定)
3. [目錄結構](#3-目錄結構)
4. [`.claude/` 配置說明](#4-claude-配置說明)
5. [日常開發流程](#5-日常開發流程)
6. [自動文件同步機制](#6-自動文件同步機制)
7. [錯誤記憶機制](#7-錯誤記憶機制)
8. [守則清單（由 hooks 強制）](#8-守則清單由-hooks-強制)
9. [常用指令速查](#9-常用指令速查)
10. [維護與擴充](#10-維護與擴充)
11. [FAQ](#11-faq)

---

## 1. 前置需求

| 項目 | 版本 | 備註 |
|---|---|---|
| OS | Windows 11 / macOS / Linux | 主要在 Windows git bash 驗證 |
| Shell | **bash**（git bash / zsh / bash） | 不支援 PowerShell / cmd |
| Miniconda / Anaconda | 最新版 | 用來建立 `aicuda` 環境 |
| Python | 3.12 | 由 conda env 提供 |
| CUDA Toolkit | 12.8 | 對應 torch `2.7.1+cu128` |
| GPU | NVIDIA（sm_80 以上建議，本專案驗證於 sm_120） | |
| Node.js | 18+ | 前端階段（Phase 5+）才需要 |
| Git | 最新版 | |
| Claude Code CLI | 已登入 | `claude.ai/code` 或 CLI 登入 |

---

## 2. 初次設定

### 2.1 Clone 並進入專案

```bash
git clone <repo-url> video2vrma
cd video2vrma
```

### 2.2 建立 conda 環境

```bash
conda create -n aicuda python=3.12 -y
conda activate aicuda

# PyTorch CUDA 12.8
pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 \
  --index-url https://download.pytorch.org/whl/cu128

# 其餘必要依賴（可依 DEVELOPMENT_PLAN.md 的清單補）
pip install fastapi uvicorn python-multipart websockets scipy \
  pytorch-lightning==1.9.5 hydra-core omegaconf transformers \
  opencv-python mediapipe pyrender trimesh chumpy yacs

# 可選依賴（PHALP/4D-Humans 可能需要）
pip install smplx
# pytorch3d / detectron2：見 lesson 0004，sm_120 的 wheel 相容性可能需要特殊處理
```

> ⚠️ 若你 clone 後 `vendor/` 是空的，表示沒有一起 clone 第三方專案，請參考 `DEVELOPMENT_PLAN.md` 的 Phase 0.2 指令 clone 所有 vendor。

### 2.3 下載 SMPL 模型

受授權限制，請自行到 <https://smpl.is.tue.mpg.de/> 申請並下載，放入 `data/smpl/`：

```
data/smpl/
├── SMPL_NEUTRAL.npz
├── basicmodel_f_lbs_10_207_0_v1.1.0.pkl
├── basicmodel_m_lbs_10_207_0_v1.1.0.pkl
└── basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl
```

這些檔案**不會**進 git（已在 `.gitignore`）。

### 2.4 驗證環境

在專案目錄開啟 Claude Code，輸入：

```
/env-check
```

Claude 會執行 `scripts/env_check.py` 並回報環境狀態。或手動跑：

```bash
conda run -n aicuda python scripts/env_check.py
```

### 2.5 給 hook 腳本執行權限（Linux / macOS）

```bash
chmod +x .claude/hooks/*.sh
```

Windows 的 git bash 不需要這步。

---

## 3. 目錄結構

```
video2vrma/
├── CLAUDE.md                  Claude 每次對話自動載入的規範
├── WORKFLOW.md                本檔案（人類使用說明）
├── DEVELOPMENT_PLAN.md        開發計畫（隨進度更新勾選狀態）
├── vendor-versions.txt        vendor/ 各子專案 commit hash（由 /vendor-sync 產生）
├── .gitignore
│
├── .claude/                   Claude Code 配置（整個 commit 進 git）
│   ├── settings.json          hooks 掛載點與權限
│   ├── hooks/                 自動守則 bash 腳本
│   │   ├── block-vendor-write.sh
│   │   ├── block-sensitive-write.sh
│   │   ├── check-conda-env.sh
│   │   └── remind-update-docs.sh
│   ├── commands/              slash commands（/xxx）
│   │   ├── env-check.md
│   │   ├── update-plan.md
│   │   ├── vendor-sync.md
│   │   ├── new-phase.md
│   │   └── save-lesson.md
│   ├── agents/                subagent 定義
│   │   ├── vendor-reader.md
│   │   └── pipeline-debugger.md
│   └── lessons/               歷史教訓
│       ├── INDEX.md           會被 CLAUDE.md 自動載入
│       ├── TEMPLATE.md        新 lesson 的格式範本
│       └── NNNN-slug.md       實際 lesson 檔案
│
├── scripts/
│   └── env_check.py           環境檢查腳本
│
├── vendor/                    第三方專案（只讀！）
│   ├── 4d-humans/
│   ├── PHALP/
│   ├── smpl2bvh/
│   └── bvh2vrma/
│
├── data/
│   └── smpl/                  SMPL 模型（不進 git）
│
├── models/                    本機模型 cache（不進 git，~6.4 GB）
├── backend/                   FastAPI 後端（Phase 1-4 建立，含 services / routers / tests）
├── frontend/                  Next.js 前端（Phase 2、5 建立，含 7 個元件 + bvh2vrma lib）
└── tmp/                       暫存 / 上傳 / 輸出（不進 git）
```

---

## 4. `.claude/` 配置說明

### 4.1 `settings.json`

掛載所有 hooks，分 `PreToolUse`（執行前攔截）與 `PostToolUse`（執行後處理）。
專案層級的設定會與使用者全域 `~/.claude/settings.json` 合併。

### 4.2 Hooks（自動守則腳本）

| 檔案 | 觸發時機 | 行為 |
|---|---|---|
| `block-vendor-write.sh` | Write/Edit/MultiEdit 前 | **攔截**任何寫入 `vendor/` 的操作，提示改走 services 層 |
| `block-sensitive-write.sh` | Write/Edit/MultiEdit 前 | **攔截**寫入 `data/smpl/`、`.env*`、`*.pem`、`*.key`、`credentials*` |
| `check-conda-env.sh` | Bash 前 | **攔截**未使用 aicuda 的 python/pip 指令；**攔截** `conda run ... python -c` 含換行 |
| `remind-update-docs.sh` | Write/Edit/MultiEdit 後 | **提醒**（不阻擋）編輯 backend/frontend 後要檢查文件同步 |

Hooks 用 bash 寫，透過 grep/sed 解析 JSON 輸入，不依賴 `jq`。退出碼：

- `exit 0`：通過（stdout 會回傳給 Claude）
- `exit 2`：阻擋（stderr 顯示給 Claude，Claude 會依訊息調整行為）

### 4.3 Slash Commands

使用者（或 Claude 自己）可以在對話中輸入 `/指令名` 觸發。定義檔是 markdown + frontmatter。

| 指令 | 用途 |
|---|---|
| `/env-check` | 執行環境檢查腳本並回報 |
| `/update-plan` | 依當前進度更新 `DEVELOPMENT_PLAN.md` 勾選 |
| `/vendor-sync` | 重新產生 `vendor-versions.txt` |
| `/new-phase` | 進入下個 Phase 的 checklist（確認前一 Phase 驗收） |
| `/save-lesson` | 將剛發生的 AI 錯誤記錄為 lesson |
| `/auto-feature <描述>` | 端到端自動開發一項功能，規劃→實作→測試→文件→commit，中途不詢問 |

### 4.4 Subagents

用於隔離工作、保護主 context，或限制工具權限。

| Subagent | 權限 | 用途 |
|---|---|---|
| `vendor-reader` | Read / Grep / Glob（唯讀） | 研讀 vendor/ 原始碼、回報 API 入口與整合建議 |
| `pipeline-debugger` | Read / Edit / Write / Bash / Grep / Glob | 跑 GPU pipeline、除錯 CUDA/NumPy/Hydra 問題、修 services 層 adapter |

### 4.5 Lessons

參見 [第 7 節：錯誤記憶機制](#7-錯誤記憶機制)。

---

## 5. 日常開發流程

### 5.1 典型對話循環

```
1. 開 Claude Code 對話（CLAUDE.md + lessons/INDEX.md 自動載入）
   ↓
2. 指派任務（例：「做 Phase 1 的 1.3 撰寫 test_e2e.py」）
   ↓
3. Claude 實作
   - hook 自動攔截寫 vendor、誤用 base 環境、conda -c 多行等
   - 需要研讀 vendor 時，Claude 會呼叫 vendor-reader subagent
   - 需要跑 GPU 測試時，可呼叫 pipeline-debugger subagent
   ↓
4. 完成一個任務單元後：
   - Claude 主動 /update-plan 更新 DEVELOPMENT_PLAN.md
   - 若有新模組，同步更新 CLAUDE.md 的目錄結構段落
   - 若被糾正過，主動 /save-lesson
   ↓
5. 使用者 review → commit
```

### 5.2 Git branch 慣例

- `main`：已驗收的狀態
- `phase-N-<slug>`：進行中的 Phase（例：`phase-1-pipeline-e2e`）
- `fix-<slug>`：臨時修復
- `.claude/` 目錄**整個** commit 進 git，團隊成員共享相同規範

### 5.3 Commit 慣例

- Commit message 一律用**繁體中文**（不是簡體、不是英文），簡述「做了什麼」與「為什麼」；技術名詞可保留英文原文
- 一次 commit 不跨 Phase
- 修改 `.claude/` 單獨 commit，訊息前綴 `chore(claude):`

---

## 6. 自動文件同步機制

### 目的

開發過程新增/修改功能時，相關 md 檔（`DEVELOPMENT_PLAN.md`、`CLAUDE.md`、`vendor-versions.txt`）必須自動保持同步，避免文件落後於實作。

### 實作方式（三層保護）

#### 第一層：CLAUDE.md 明文規範

`CLAUDE.md`「開發工作流程 A」明確要求 Claude 在**每次完成功能單元後**檢查並更新：
- `DEVELOPMENT_PLAN.md` 勾選狀態
- `CLAUDE.md` 的目錄 / API / 依賴段落
- `vendor-versions.txt`（若有 vendor 變動）

Claude 會主動執行，不需使用者每次提醒。

#### 第二層：Slash Command 明確觸發

`/update-plan`、`/vendor-sync` 是可重複、可稽核的更新動作。
使用者任何時候覺得「進度跟文件不同步」，可以手動觸發。

#### 第三層：PostToolUse Hook 提醒

`.claude/hooks/remind-update-docs.sh` 會在編輯 `backend/app/` 或 `frontend/src/` 後，
把一段提醒文字送回 Claude 的 context，強化 CLAUDE.md 的規則。

這三層互相加強：CLAUDE.md 是規範、slash command 是工具、hook 是提醒。

---

## 7. 錯誤記憶機制

### 目的

AI 在對話中會犯錯。若每次都只是當場修正，下次還會犯同樣的錯。
**Lesson 機制**把系統性錯誤記成檔案，下次對話開始時自動載入，避免重犯。

### 運作流程

```
使用者糾正 AI
    ↓
AI 判斷：是系統性錯誤嗎？
    ├── 是 → 執行 /save-lesson 或主動寫 lesson 檔
    │        ├── 讀 .claude/lessons/INDEX.md 找編號
    │        ├── 讀 .claude/lessons/TEMPLATE.md 取格式
    │        ├── 建 .claude/lessons/NNNN-slug.md
    │        └── 在 INDEX.md 加索引
    └── 否（一次性筆誤）→ 道歉改正，不記錄

下次對話開始
    ↓
CLAUDE.md 透過 @.claude/lessons/INDEX.md 自動載入
    ↓
AI 看見過往教訓，行為調整
```

### Lesson 內容要求

每條 lesson 四段：

1. **錯誤是什麼**：具體描述，含關鍵錯誤訊息或符號
2. **為什麼犯**：根因，不是表面症狀
3. **未來如何避免**：可執行的具體規則
4. **如何判斷適用**：邊界條件，什麼時候這條會觸發

**寫 lesson 的黃金原則**：脫離當前對話也要能讀懂。不要寫「剛剛 X 函式寫錯了」，
要寫「在 Windows bash 下處理 conda 指令時的通用守則」。

### 本專案 lessons

- `0001` — conda run 不支援 python -c 多行
- `0002` — vendor/ 是只讀
- `0003` — Windows git bash 慣例
- `0004` — sm_120 wheel 相容性
- `0005` — vendor/ 只讀時用 sys.modules stub + monkey-patch 繞 import side-effect
- `0006` — PHALP→BVH→VRMA→VRM 跨階段座標系與 rig 陷阱

詳見 `.claude/lessons/` 各檔。

### 維護

- 每個 Phase 結束時，review 一次 lessons 是否有過時條目（例如某個套件升級後問題消失）
- 過時的 lesson：加上 `deprecated: true` frontmatter，並在 INDEX 標註 `(deprecated)`
- 刪除 lesson 要謹慎：歷史教訓即使不再觸發，仍是「為什麼我們現在這樣做」的佐證

---

## 8. 守則清單（由 hooks 強制）

| # | 規則 | 強制方式 |
|---|---|---|
| 1 | 禁止寫入 `vendor/**` | `block-vendor-write.sh`（阻擋） |
| 2 | 禁止寫入 `data/smpl/**`、`.env*`、`*.pem`、`*.key`、`credentials*` | `block-sensitive-write.sh`（阻擋） |
| 3 | python/pip/uvicorn/pytest 必須透過 aicuda 環境 | `check-conda-env.sh`（阻擋） |
| 4 | `conda run ... python -c` 不得含換行 | `check-conda-env.sh`（阻擋） |
| 5 | 編輯 backend/frontend 後要檢查文件同步 | `remind-update-docs.sh`（提醒） |

若你**確定**要繞過某條規則（例如手動合入 vendor 上游 patch），兩種做法：

- 臨時：在 `.claude/settings.json` 註解該 hook 條目，做完恢復
- 長期：與團隊討論後修改 hook 行為，commit 更新

---

## 9. 常用指令速查

### Claude 對話中

```
/env-check                  # 驗證 aicuda 環境
/update-plan                # 更新 DEVELOPMENT_PLAN.md 勾選
/vendor-sync                # 產生 vendor-versions.txt
/new-phase                  # 進入下個 Phase 的 checklist
/save-lesson                # 記錄一條 AI 錯誤
/auto-feature <功能描述>    # 自動開發一項功能至完成並 commit
```

### 終端機

```bash
# 環境檢查
conda run -n aicuda python scripts/env_check.py

# 啟動後端（Phase 4 起可用）
cd backend && conda run -n aicuda uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 啟動前端（Phase 5 起可用）
cd frontend && npm run dev

# 產生 vendor hash
{
  for d in vendor/*/; do
    name=$(basename "$d")
    hash=$(cd "$d" && git rev-parse --short HEAD 2>/dev/null || echo "-")
    echo "$name: $hash"
  done
} > vendor-versions.txt
```

---

## 10. 維護與擴充

### 新增一條 hook

1. 在 `.claude/hooks/` 建 `foo.sh`（參考現有 hook 的 JSON 解析與退出碼模式）
2. 在 `.claude/settings.json` 對應的 `matcher` 陣列加一行
3. Linux/macOS `chmod +x`
4. 在 `WORKFLOW.md` 第 4.2 節的表格補一行
5. Commit

### 新增一條 slash command

1. 在 `.claude/commands/` 建 `foo.md`，frontmatter 含 `description`
2. 本文描述 Claude 收到 `/foo` 時該做什麼（步驟式）
3. 在 `CLAUDE.md` 與 `WORKFLOW.md` 的指令表補一行
4. Commit

### 新增一個 subagent

1. 在 `.claude/agents/` 建 `foo.md`，frontmatter 含 `name`, `description`, `tools`
2. 本文是 subagent 的 system prompt（它的身份、規則、輸出格式）
3. 在 `WORKFLOW.md` 第 4.4 節表格補一行
4. Commit

### 升級 vendor

1. `cd vendor/xxx && git pull`（或 `git checkout <newcommit>`）
2. 跑 `/env-check` 與現有測試，確認相容性
3. 若有 breaking change，patch 寫在 `backend/app/services/` 的 adapter 層
4. `/vendor-sync` 更新 `vendor-versions.txt`
5. Commit

---

## 11. FAQ

**Q: Hook 擋住我了，怎麼辦？**
A: 先讀 stderr 訊息 — 通常會告訴你正確做法。若真的需要繞過，見第 8 節。

**Q: AI 每次都忘記用 aicuda？**
A: `check-conda-env.sh` 會攔截。若某個情境常漏，寫成 lesson 強化。

**Q: 我想改 vendor/ 的一行程式碼做實驗？**
A: Hook 會擋。若真的想快速實驗，先 `cp vendor/.../foo.py /tmp/` 改了跑，驗證後再在 services 層寫正式 patch。

**Q: `/update-plan` 會不會把我的手動編輯蓋掉？**
A: 不會。該指令只更新勾選狀態與新增完成的任務條目，**不重寫內容**。若遇到結構性調整，Claude 會先問你。

**Q: Lesson 越積越多，context 塞得下嗎？**
A: 只有 `INDEX.md` 會自動載入（該檔案設計為 < 1KB）。完整 lesson 內容只在 Claude 主動查閱時讀取。

**Q: 我要加一個全新的外部工具（例如 MCP server）？**
A: 本規範目前沒規劃 MCP。要加就在 `.claude/settings.json` 加 `mcpServers` 區塊，並在 `WORKFLOW.md` 補說明。先與團隊討論是否真的需要。

**Q: 解壓縮後遺失執行權限（Linux/macOS）？**
A: `chmod +x .claude/hooks/*.sh`

**Q: 全新的團隊成員怎麼 onboarding？**
A: 讓他讀本檔案（WORKFLOW.md）的第 1-2 節做環境設定，第 3-8 節理解規範，之後就可以直接開 Claude Code 工作。CLAUDE.md 與 lessons 會自動生效。

---

**最後**：本檔案本身也是會演進的。若你在使用中發現規範不清楚、hook 誤擋、流程卡關，
請修改本檔與對應的 `.claude/` 設定，一起 commit 進 git。
