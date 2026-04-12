from pathlib import Path

from app.config import DEFAULT_END_FRAME, DEFAULT_FPS, SMPL_ROOT

from .phalp_service import run_phalp
from .preview import render_overlay_video, render_skeleton_gif
from .smoothing import smooth_pose_aa
from .smpl_to_bvh_service import convert_pkl_to_bvh
from .track_extractor import extract_longest_track


def run_e2e(
    video_path: str | Path,
    output_dir: str | Path,
    end_frame: int = DEFAULT_END_FRAME,
    fps: int = DEFAULT_FPS,
    preview: bool = True,
    smoothing: bool = False,
) -> dict:
    video_path = Path(video_path).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    phalp_out = output_dir / "phalp"
    pkl_path = run_phalp(video_path, phalp_out, end_frame=end_frame)

    pose_aa, _tid = extract_longest_track(pkl_path)
    if smoothing:
        pose_aa = smooth_pose_aa(pose_aa)

    bvh_path = output_dir / f"{video_path.stem}.bvh"
    convert_pkl_to_bvh(
        pkl_path=pkl_path,
        output_bvh=bvh_path,
        smpl_root=SMPL_ROOT,
        fps=fps,
        pose_aa=pose_aa,
    )

    result = {"pkl": pkl_path, "bvh": bvh_path}
    if preview:
        gif_path = output_dir / f"{video_path.stem}_skeleton.gif"
        render_skeleton_gif(
            pkl_path=pkl_path,
            output_gif=gif_path,
            smpl_root=SMPL_ROOT,
            fps=fps,
        )
        result["gif"] = gif_path

        overlay_path = output_dir / f"{video_path.stem}_overlay.mp4"
        render_overlay_video(
            pkl_path=pkl_path,
            output_mp4=overlay_path,
            fps=fps,
        )
        result["overlay"] = overlay_path
    return result
