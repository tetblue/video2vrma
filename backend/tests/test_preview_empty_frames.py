"""Phase 12：render_overlay_video 對 PHALP 空偵測幀的防禦測試。

PHALP pkl 中每幀都可能 size=[]/tid=[]/2d_joints=[]（該幀無人），空幀可能
出現在影片任何位置。此測試構造最小 fake pkl 驗證 render_overlay_video
能正確處理各種空幀分佈。
"""
from pathlib import Path

import cv2
import joblib
import numpy as np
import pytest

from app.services import preview
from app.services.preview import render_overlay_video


H, W = 8, 8


def _write_fake_frame(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = np.full((H, W, 3), 128, dtype=np.uint8)
    cv2.imwrite(str(path), img)


def _frame_dict(frame_path: Path, has_detection: bool) -> dict:
    if has_detection:
        j2d = np.tile([0.5, 0.5], (25, 1)).astype(np.float32)
        return {
            "frame_path": str(frame_path),
            "size": [(H, W)],
            "tid": [1],
            "2d_joints": [j2d],
        }
    return {
        "frame_path": str(frame_path),
        "size": [],
        "tid": [],
        "2d_joints": [],
    }


def _build_pkl(tmp_path: Path, pattern: list[bool]) -> Path:
    """pattern[i] = True 表示第 i 幀有偵測"""
    data: dict[str, dict] = {}
    for i, has_det in enumerate(pattern):
        key = f"frame_{i:04d}.jpg"
        frame_path = tmp_path / "frames" / key
        _write_fake_frame(frame_path)
        data[key] = _frame_dict(frame_path, has_det)
    pkl_path = tmp_path / "fake.pkl"
    joblib.dump(data, pkl_path)
    return pkl_path


@pytest.fixture(autouse=True)
def _skip_ffmpeg_reencode(monkeypatch):
    """測試環境不必依賴 ffmpeg，把 re-encode 改成 src→dst copy"""
    import shutil as _sh

    def fake_reencode(src: Path, dst: Path) -> None:
        _sh.copy(str(src), str(dst))

    monkeypatch.setattr(preview, "_reencode_h264", fake_reencode)


def test_empty_frames_scattered_at_any_position(tmp_path):
    # 10 幀中 0、4、5、9 皆空
    pattern = [False, True, True, True, False, False, True, True, True, False]
    pkl = _build_pkl(tmp_path, pattern)
    out = tmp_path / "out.mp4"
    result = render_overlay_video(pkl, out, fps=10)
    assert result.exists()
    assert result.stat().st_size > 0


def test_only_middle_frame_has_detection(tmp_path):
    # 只有第 5 幀有偵測，驗證掃找機制能找到非首幀的 size
    pattern = [False] * 10
    pattern[5] = True
    pkl = _build_pkl(tmp_path, pattern)
    out = tmp_path / "out.mp4"
    result = render_overlay_video(pkl, out, fps=10)
    assert result.exists()


def test_all_frames_empty_raises_runtime_error(tmp_path):
    # 全部幀皆空：應拋 RuntimeError（因為 tid_counts 為空），不是 IndexError
    pattern = [False] * 5
    pkl = _build_pkl(tmp_path, pattern)
    out = tmp_path / "out.mp4"
    with pytest.raises(RuntimeError, match="no tracks in PHALP pkl"):
        render_overlay_video(pkl, out, fps=10)
