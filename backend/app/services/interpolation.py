"""對跳幀取樣的 pose_aa 做 quaternion SLERP 補幀，回復原生幀率。"""
import numpy as np
from scipy.spatial.transform import Rotation as R, Slerp


def interpolate_pose_aa(pose_aa: np.ndarray, factor: int) -> np.ndarray:
    """對每個 joint 做 quaternion SLERP 插值，補幀 `factor` 倍。

    Args:
        pose_aa: (N, J, 3) axis-angle，N 是跳幀取樣後的幀數。
        factor: 插值倍率；frame_step=3 時 factor=3 把 N 幀擴為 (N-1)*3+1 幀。

    Returns:
        (N_new, J, 3) axis-angle，N_new = (N-1)*factor + 1。
        factor <= 1 或 N <= 1 時原樣回傳（copy）。
    """
    if pose_aa.ndim != 3 or pose_aa.shape[2] != 3:
        raise ValueError(f"expected (N, J, 3), got {pose_aa.shape}")
    n, joints, _ = pose_aa.shape
    if factor <= 1 or n <= 1:
        return pose_aa.astype(np.float32, copy=True)

    times_src = np.arange(n, dtype=np.float64)
    times_dst = np.linspace(0.0, float(n - 1), (n - 1) * factor + 1)
    out = np.zeros((times_dst.shape[0], joints, 3), dtype=np.float32)
    for j in range(joints):
        rots = R.from_rotvec(pose_aa[:, j, :].astype(np.float64))
        slerp = Slerp(times_src, rots)
        out[:, j, :] = slerp(times_dst).as_rotvec().astype(np.float32)
    return out
