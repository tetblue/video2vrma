import pickle
from pathlib import Path

import joblib
import numpy as np
from scipy.spatial.transform import Rotation as R

from . import vendor_paths  # noqa: F401


def _ensure_smpl_layout(root: Path) -> Path:
    """smplx 需要 <root>/smpl/SMPL_NEUTRAL.{pkl,npz} 的巢狀結構。

    smplx.create 會優先找 .pkl，再找 .npz；我們同時擺兩種：
    - .npz 從 data/smpl/SMPL_NEUTRAL.npz hard link 過去
    - .pkl 從 data/smpl/basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl 轉 py3 後寫入
    """
    import os
    import pickle
    import shutil

    nested_dir = root / "smpl"
    nested_dir.mkdir(exist_ok=True)

    npz_src = root / "SMPL_NEUTRAL.npz"
    npz_dst = nested_dir / "SMPL_NEUTRAL.npz"
    if npz_src.exists() and not npz_dst.exists():
        try:
            os.link(npz_src, npz_dst)
        except OSError:
            shutil.copy2(npz_src, npz_dst)

    pkl_dst = nested_dir / "SMPL_NEUTRAL.pkl"
    if not pkl_dst.exists():
        pkl_src = root / "basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl"
        if not pkl_src.exists():
            raise FileNotFoundError(f"SMPL neutral pkl not found at {pkl_src}")
        import dill  # noqa: F401
        try:
            dill._dill._reverse_typemap["ObjectType"] = object  # type: ignore[attr-defined]
        except Exception:
            pass
        with open(pkl_src, "rb") as f:
            loaded = pickle.load(f, encoding="latin1")
        with open(pkl_dst, "wb") as f:
            pickle.dump(loaded, f)

    return root


# 把 PHALP 相機座標 (Y down, Z forward) 的 global_orient 轉到 VRM/SMPL
# 世界座標 (Y up, Z forward)，避免 BVH 載到 three.js / VRM 上出現上下顛倒
# 與背對相機。只 pre-multiply root 旋轉，body_pose 是相對 parent 的 local
# 旋轉，不需要額外轉換。
_R_CAM_TO_VRM = np.diag([1.0, -1.0, -1.0]).astype(np.float32)


def extract_longest_track(pkl_path: str | Path) -> tuple[np.ndarray, int]:
    data = joblib.load(pkl_path)
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

    if not tracks:
        raise RuntimeError("No SMPL tracks found in PHALP output")

    tid, seq = max(tracks.items(), key=lambda kv: len(kv[1]))
    n = len(seq)
    pose_aa = np.zeros((n, 24, 3), dtype=np.float32)
    for k, (_, smpl) in enumerate(seq):
        go = np.asarray(smpl["global_orient"]).reshape(3, 3)
        bp = np.asarray(smpl["body_pose"]).reshape(23, 3, 3)
        go = _R_CAM_TO_VRM @ go  # 相機 → VRM 世界
        mats = np.concatenate([go[None], bp], axis=0)  # (24, 3, 3)
        pose_aa[k] = R.from_matrix(mats).as_rotvec().astype(np.float32)
    return pose_aa, tid


def convert_pkl_to_bvh(
    pkl_path: str | Path,
    output_bvh: str | Path,
    smpl_root: str | Path,
    fps: int = 30,
) -> Path:
    pose_aa, tid = extract_longest_track(pkl_path)
    n = pose_aa.shape[0]

    smpl_root = Path(smpl_root).resolve()
    _ensure_smpl_layout(smpl_root)

    output_bvh = Path(output_bvh).resolve()
    output_bvh.parent.mkdir(parents=True, exist_ok=True)

    tmp_pkl = output_bvh.with_suffix(".pose.pkl")
    payload = {
        "smpl_poses": pose_aa.reshape(n, 72),
        "smpl_trans": np.zeros((n, 3), dtype=np.float32),
        "smpl_scaling": np.array([1.0], dtype=np.float32),
    }
    with open(tmp_pkl, "wb") as f:
        pickle.dump(payload, f)

    from smpl2bvh import smpl2bvh as smpl2bvh_fn

    smpl2bvh_fn(
        model_path=str(smpl_root),
        poses=str(tmp_pkl),
        output=str(output_bvh),
        mirror=False,
        model_type="smpl",
        gender="NEUTRAL",
        num_betas=10,
        fps=fps,
    )

    tmp_pkl.unlink(missing_ok=True)
    if not output_bvh.exists():
        raise FileNotFoundError(f"smpl2bvh did not produce BVH at {output_bvh}")
    return output_bvh
