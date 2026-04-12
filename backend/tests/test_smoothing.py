import numpy as np

from app.services.smoothing import smooth_pose_aa


def test_shape_preserved():
    rng = np.random.default_rng(0)
    pose = rng.normal(0, 0.1, size=(60, 24, 3)).astype(np.float32)
    out = smooth_pose_aa(pose)
    assert out.shape == pose.shape
    assert out.dtype == np.float32


def test_reduces_high_frequency_noise():
    rng = np.random.default_rng(42)
    n = 120
    t = np.linspace(0, 4 * np.pi, n, dtype=np.float32)
    clean = np.zeros((n, 24, 3), dtype=np.float32)
    clean[:, 0, 0] = 0.3 * np.sin(t)
    noise = rng.normal(0, 0.05, size=clean.shape).astype(np.float32)
    noisy = clean + noise

    smoothed = smooth_pose_aa(noisy, window=9, polyorder=3)
    noisy_res = np.linalg.norm(noisy - clean)
    smoothed_res = np.linalg.norm(smoothed - clean)
    assert smoothed_res < noisy_res * 0.75


def test_short_sequence_passthrough():
    pose = np.zeros((3, 24, 3), dtype=np.float32)
    out = smooth_pose_aa(pose, window=7, polyorder=3)
    assert out.shape == pose.shape
    assert np.allclose(out, pose)
