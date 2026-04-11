---
id: 0004
slug: sm120-wheel-compatibility
title: RTX 5070 Ti sm_120 預編 wheel 相容性有限
date: 2026-04-11
tags: [cuda, environment, gpu]
---

## 錯誤是什麼

RTX 5070 Ti Laptop 的 Compute Capability 是 **12.0 (sm_120)**，這是相對新的架構。
許多 Python 套件的預編 wheel（pip install 下載的）沒有為 sm_120 編譯對應的 CUDA kernel，
執行時會出現：

- `RuntimeError: CUDA error: no kernel image is available for execution on the device`
- `torch not compiled with CUDA` 類型錯誤
- 或在 import 時直接 segfault

已知受影響的套件：

- `pytorch3d`：官方只提供到 sm_90，sm_120 需要從原始碼編譯。**另注意 stable branch 的 pulsar 子模組會撞到 CUDA 12.8 libcu++ 的新 `cuda/std/__tuple_dir/vector_types.h`（error: expected a ">"），main branch 已修**，Phase 0 驗證用 `git+https://github.com/facebookresearch/pytorch3d.git@main` 編譯成功 0.7.9
- `detectron2`：Windows 沒官方 wheel，但 `git+https://github.com/facebookresearch/detectron2.git` 在 VS 2022 + CUDA 12.8 + torch 2.7.1 環境下可編譯（本專案已成功裝 0.6，nms CUDA kernel 在 sm_120 實測通過）
- 舊版 `flash-attn`：需要較新版本才支援
- 部分 `onnxruntime-gpu` 版本

torch 本身 `2.7.1+cu128` **已支援** sm_120，且本專案已驗證 CUDA 可用。

## 為什麼犯

把「CUDA 可用」當成「所有 CUDA 套件都可用」。torch 有支援不代表生態系其他套件也有，
預編 wheel 是逐套件編譯的，每個套件的 compute capability 覆蓋範圍不同。

## 未來如何避免

1. **先驗證 torch**：`torch.cuda.is_available()` 與 `torch.cuda.get_device_capability()` 確認 sm_120
2. **套件安裝前查 compute capability 支援**：看 GitHub release notes 或 issue tracker
3. **pytorch3d**：pypi 沒有 Windows wheel，直接走 git main branch 原始碼編譯（**不要用 @stable**，pulsar 子模組會撞 CUDA 12.8 新 header）。環境需求：VS 2022 C++ Build Tools、CUDA 12.8、`TORCH_CUDA_ARCH_LIST=12.0`、`FORCE_CUDA=1`、先裝 `cmake fvcore iopath`。建置腳本範例見 `scripts/build_install_pytorch3d.bat`
4. **detectron2**：pypi 沒有 Windows wheel，直接走 `git+https://github.com/facebookresearch/detectron2.git` 原始碼編譯。環境需求同上（VS + CUDA + arch list）。建置腳本範例見 `scripts/build_install_detectron2.bat`
5. **共用建置流程**：從 git bash 呼叫 `MSYS_NO_PATHCONV=1 cmd.exe /c "scripts\build_install_*.bat"`，bat 內先 `call vcvars64.bat` 再 `conda run -n aicuda pip install --no-build-isolation git+...`
5. **錯誤訊號**：看到 `no kernel image` 就是 compute capability 不符，不要以為是 driver 問題

## 如何判斷是否適用

- 任何需要安裝 GPU-aware Python 套件時
- 任何看到 `no kernel image` 或執行時 CUDA 相關 RuntimeError 時
- 若未來換到 sm_80/sm_90 的 GPU（例如 RTX 4090 / A100），此 lesson 不再適用，但
  原則「驗證套件對你的 compute capability 的支援」仍有效
