import numpy as np
import pytest
from scipy.spatial.transform import Rotation as R

from app.services.interpolation import interpolate_pose_aa


def test_factor_one_is_noop():
    pose = np.random.RandomState(0).randn(5, 24, 3).astype(np.float32) * 0.3
    out = interpolate_pose_aa(pose, factor=1)
    assert out.shape == pose.shape
    np.testing.assert_array_equal(out, pose.astype(np.float32))


def test_factor_three_triples_frame_count():
    n = 5
    pose = np.random.RandomState(1).randn(n, 24, 3).astype(np.float32) * 0.2
    out = interpolate_pose_aa(pose, factor=3)
    assert out.shape == ((n - 1) * 3 + 1, 24, 3)
    # 端點必須精準等於原 frame（slerp 在 t=0 與 t=N-1 等同 source）
    np.testing.assert_allclose(
        R.from_rotvec(out[0].astype(np.float64)).as_matrix(),
        R.from_rotvec(pose[0].astype(np.float64)).as_matrix(),
        atol=1e-5,
    )
    np.testing.assert_allclose(
        R.from_rotvec(out[-1].astype(np.float64)).as_matrix(),
        R.from_rotvec(pose[-1].astype(np.float64)).as_matrix(),
        atol=1e-5,
    )


def test_quaternions_remain_unit_norm():
    pose = np.random.RandomState(2).randn(4, 24, 3).astype(np.float32) * 0.5
    out = interpolate_pose_aa(pose, factor=4)
    quats = R.from_rotvec(out.reshape(-1, 3).astype(np.float64)).as_quat()
    norms = np.linalg.norm(quats, axis=1)
    np.testing.assert_allclose(norms, 1.0, atol=1e-6)


def test_empty_or_single_frame_returns_copy():
    # 1 幀無法 slerp，原樣回傳
    pose = np.array([[[0.1, 0.2, 0.3]] * 24], dtype=np.float32)
    out = interpolate_pose_aa(pose, factor=5)
    assert out.shape == pose.shape


def test_raises_on_bad_shape():
    with pytest.raises(ValueError):
        interpolate_pose_aa(np.zeros((5, 3), dtype=np.float32), factor=3)
