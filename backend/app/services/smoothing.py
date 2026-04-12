import numpy as np
from scipy.signal import savgol_filter
from scipy.spatial.transform import Rotation as R

from app.config import SMOOTHING_POLYORDER, SMOOTHING_WINDOW


def smooth_pose_aa(
    pose_aa: np.ndarray,
    window: int = SMOOTHING_WINDOW,
    polyorder: int = SMOOTHING_POLYORDER,
) -> np.ndarray:
    """在 rotation matrix 空間做 Savitzky-Golay 平滑，再投影回 axis-angle。

    直接對 axis-angle 做 savgol 會在 π 附近跳變，所以先轉 matrix，逐元素平滑，
    再用 SVD 投影回合法旋轉矩陣。輸入/輸出 shape 都是 (n, 24, 3)。
    """
    if pose_aa.ndim != 3 or pose_aa.shape[2] != 3:
        raise ValueError(f"expected (n, J, 3), got {pose_aa.shape}")

    n, joints, _ = pose_aa.shape
    if n < window or window < polyorder + 2:
        return pose_aa.astype(np.float32, copy=True)
    if window % 2 == 0:
        window += 1

    mats = R.from_rotvec(pose_aa.reshape(-1, 3)).as_matrix().reshape(n, joints, 3, 3)
    flat = mats.reshape(n, joints * 9)
    smoothed_flat = savgol_filter(flat, window_length=window, polyorder=polyorder, axis=0)
    smoothed = smoothed_flat.reshape(n, joints, 3, 3)

    u, _, vt = np.linalg.svd(smoothed)
    proj = u @ vt
    det = np.linalg.det(proj)
    flip = np.sign(det)
    flip[flip == 0] = 1.0
    u[..., :, -1] *= flip[..., None]
    proj = u @ vt

    out = R.from_matrix(proj.reshape(-1, 3, 3)).as_rotvec().reshape(n, joints, 3)
    return out.astype(np.float32)
