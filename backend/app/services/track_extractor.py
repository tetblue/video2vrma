from pathlib import Path

import joblib
import numpy as np
from scipy.spatial.transform import Rotation as R

# PHALP 相機座標 (Y down, Z forward) → VRM/SMPL 世界座標 (Y up, Z forward)
# 只 pre-multiply root 旋轉；body_pose 是 parent-local 不需要轉。見 lesson 0006。
R_CAM_TO_VRM = np.diag([1.0, -1.0, -1.0]).astype(np.float32)


def load_phalp_pkl(pkl_path: str | Path) -> dict:
    return joblib.load(pkl_path)


def collect_tracks(data: dict) -> dict[int, list[tuple[int, dict]]]:
    frames = sorted(data.keys())
    tracks: dict[int, list[tuple[int, dict]]] = {}
    for fi, fname in enumerate(frames):
        f = data[fname]
        tids = f.get("tid", [])
        smpls = f.get("smpl", [])
        for tid, smpl in zip(tids, smpls):
            if smpl is None:
                continue
            tracks.setdefault(int(tid), []).append((fi, smpl))
    return tracks


def smpl_track_to_axis_angle(
    seq: list[tuple[int, dict]],
    cam_to_vrm: np.ndarray = R_CAM_TO_VRM,
) -> np.ndarray:
    n = len(seq)
    pose_aa = np.zeros((n, 24, 3), dtype=np.float32)
    for k, (_, smpl) in enumerate(seq):
        go = np.asarray(smpl["global_orient"]).reshape(3, 3)
        bp = np.asarray(smpl["body_pose"]).reshape(23, 3, 3)
        go = cam_to_vrm @ go
        mats = np.concatenate([go[None], bp], axis=0)
        pose_aa[k] = R.from_matrix(mats).as_rotvec().astype(np.float32)
    return pose_aa


def extract_longest_track(pkl_path: str | Path) -> tuple[np.ndarray, int]:
    data = load_phalp_pkl(pkl_path)
    tracks = collect_tracks(data)
    if not tracks:
        raise RuntimeError("No SMPL tracks found in PHALP output")
    tid, seq = max(tracks.items(), key=lambda kv: len(kv[1]))
    return smpl_track_to_axis_angle(seq), tid
