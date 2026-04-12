import numpy as np
from scipy.spatial.transform import Rotation as R

from app.services.track_extractor import (
    R_CAM_TO_VRM,
    collect_tracks,
    smpl_track_to_axis_angle,
)


def _make_smpl(n_joints_body: int = 23) -> dict:
    return {
        "global_orient": np.eye(3, dtype=np.float32),
        "body_pose": np.tile(np.eye(3, dtype=np.float32), (n_joints_body, 1, 1)),
    }


def test_collect_tracks_picks_longest():
    data = {
        "f0": {"tid": [1, 2], "smpl": [_make_smpl(), _make_smpl()]},
        "f1": {"tid": [1], "smpl": [_make_smpl()]},
        "f2": {"tid": [1], "smpl": [_make_smpl()]},
    }
    tracks = collect_tracks(data)
    assert set(tracks.keys()) == {1, 2}
    assert len(tracks[1]) == 3
    assert len(tracks[2]) == 1


def test_collect_tracks_skips_none():
    data = {"f0": {"tid": [1], "smpl": [None]}}
    assert collect_tracks(data) == {}


def test_smpl_track_to_axis_angle_shape_and_cam_flip():
    # global_orient 是 rotation around Y by 90°，應被 diag(1,-1,-1) 翻成 rotvec 反向
    rot_y = R.from_euler("y", 90, degrees=True).as_matrix().astype(np.float32)
    seq = [(0, {"global_orient": rot_y, "body_pose": np.tile(np.eye(3), (23, 1, 1))})]
    pose_aa = smpl_track_to_axis_angle(seq)
    assert pose_aa.shape == (1, 24, 3)
    # cam_to_vrm 作用於 root：root_new = diag(1,-1,-1) @ R_y(90°)
    expected_root = R.from_matrix(R_CAM_TO_VRM @ rot_y).as_rotvec().astype(np.float32)
    assert np.allclose(pose_aa[0, 0], expected_root, atol=1e-5)
    # body_pose 是 identity，rotvec 應為 0
    assert np.allclose(pose_aa[0, 1:], 0.0, atol=1e-6)
