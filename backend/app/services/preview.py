from pathlib import Path

import joblib
import numpy as np

from . import vendor_paths  # noqa: F401
from .smpl_to_bvh_service import _ensure_smpl_layout
from .track_extractor import extract_longest_track

SMPL_PARENTS = [
    -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8,
    9, 9, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21,
]

# PHALP 的 2d_joints 經過 hmr2/phalp 的 smpl wrapper remap 成 OpenPose body25
# 順序（不是 SMPL canonical），所以骨架連線要用 OpenPose body25 的 bone pairs。
OPENPOSE_BODY25_PAIRS = [
    (1, 0),    # Neck-Nose
    (1, 2), (2, 3), (3, 4),     # right arm
    (1, 5), (5, 6), (6, 7),     # left arm
    (1, 8),                     # neck-midhip
    (8, 9), (9, 10), (10, 11),  # right leg
    (8, 12), (12, 13), (13, 14),  # left leg
    (0, 15), (15, 17),          # right face
    (0, 16), (16, 18),          # left face
    (14, 19), (19, 20), (14, 21),  # left foot
    (11, 22), (22, 23), (11, 24),  # right foot
]


def render_skeleton_gif(
    pkl_path: str | Path,
    output_gif: str | Path,
    smpl_root: str | Path,
    fps: int = 30,
    stride: int = 1,
) -> Path:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.animation import FuncAnimation, PillowWriter
    import smplx
    import torch

    pose_aa, _tid = extract_longest_track(pkl_path)
    pose_aa = pose_aa[::stride]
    n = pose_aa.shape[0]

    smpl_root = Path(smpl_root).resolve()
    _ensure_smpl_layout(smpl_root)

    model = smplx.create(
        model_path=str(smpl_root),
        model_type="smpl",
        gender="NEUTRAL",
        batch_size=n,
    )

    global_orient = torch.from_numpy(pose_aa[:, 0:1, :].reshape(n, 3)).float()
    body_pose = torch.from_numpy(pose_aa[:, 1:, :].reshape(n, 69)).float()
    with torch.no_grad():
        out = model(global_orient=global_orient, body_pose=body_pose)
    joints = out.joints.detach().cpu().numpy()[:, :24, :]  # (n, 24, 3)
    # PHALP / HMR2 輸出在相機座標（Y 朝下），反向讓畫面是正向直立
    joints[:, :, 1] *= -1

    lo = joints.reshape(-1, 3).min(axis=0)
    hi = joints.reshape(-1, 3).max(axis=0)
    mid = (lo + hi) / 2
    half = max((hi - lo).max() / 2, 0.5)
    xlim = (mid[0] - half, mid[0] + half)
    ylim = (mid[2] - half, mid[2] + half)
    zlim = (mid[1] - half, mid[1] + half)

    fig = plt.figure(figsize=(5, 5), dpi=100)
    ax = fig.add_subplot(111, projection="3d")

    def animate(i: int):
        ax.clear()
        j = joints[i]
        xs, ys, zs = j[:, 0], j[:, 2], j[:, 1]
        ax.scatter(xs, ys, zs, c="red", s=18)
        for k, p in enumerate(SMPL_PARENTS):
            if p < 0:
                continue
            ax.plot(
                [j[k, 0], j[p, 0]],
                [j[k, 2], j[p, 2]],
                [j[k, 1], j[p, 1]],
                c="steelblue",
                linewidth=2,
            )
        ax.set_xlim(*xlim)
        ax.set_ylim(*ylim)
        ax.set_zlim(*zlim)
        ax.set_box_aspect((1, 1, 1))
        ax.set_title(f"frame {i * stride} / {n * stride}")
        ax.view_init(elev=15, azim=-70)

    anim = FuncAnimation(fig, animate, frames=n, interval=1000 / fps)
    output_gif = Path(output_gif).resolve()
    output_gif.parent.mkdir(parents=True, exist_ok=True)
    anim.save(str(output_gif), writer=PillowWriter(fps=fps))
    plt.close(fig)
    return output_gif


def render_overlay_video(
    pkl_path: str | Path,
    output_mp4: str | Path,
    fps: int = 30,
) -> Path:
    import cv2

    data = joblib.load(pkl_path)
    frame_keys = sorted(data.keys())
    if not frame_keys:
        raise RuntimeError("empty PHALP pkl")

    # 挑最長 track
    tid_counts: dict[int, int] = {}
    for fk in frame_keys:
        for tid in data[fk].get("tid", []):
            tid_counts[int(tid)] = tid_counts.get(int(tid), 0) + 1
    if not tid_counts:
        raise RuntimeError("no tracks in PHALP pkl")
    target_tid = max(tid_counts.items(), key=lambda kv: kv[1])[0]

    first = data[frame_keys[0]]
    img_h, img_w = first["size"][0]
    new_size = max(img_h, img_w)
    pad_x = (new_size - img_w) // 2
    pad_y = (new_size - img_h) // 2

    output_mp4 = Path(output_mp4).resolve()
    output_mp4.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output_mp4), fourcc, fps, (img_w, img_h))
    if not writer.isOpened():
        raise RuntimeError(f"cv2.VideoWriter could not open {output_mp4}")

    for fk in frame_keys:
        f = data[fk]
        img_path = Path(f["frame_path"].replace("\\", "/"))
        img = cv2.imread(str(img_path))
        if img is None:
            continue

        tids = list(f.get("tid", []))
        if target_tid in tids:
            idx = tids.index(target_tid)
            j2d = np.asarray(f["2d_joints"][idx]).reshape(-1, 2)[:25]
            px = j2d[:, 0] * new_size - pad_x
            py = j2d[:, 1] * new_size - pad_y

            for a, b in OPENPOSE_BODY25_PAIRS:
                p1 = (int(px[a]), int(py[a]))
                p2 = (int(px[b]), int(py[b]))
                cv2.line(img, p1, p2, (0, 200, 255), 3, lineType=cv2.LINE_AA)
            for k in range(25):
                cv2.circle(img, (int(px[k]), int(py[k])), 4, (0, 255, 0), -1, lineType=cv2.LINE_AA)

        writer.write(img)

    writer.release()
    if not output_mp4.exists() or output_mp4.stat().st_size == 0:
        raise RuntimeError(f"overlay video not written: {output_mp4}")
    return output_mp4
