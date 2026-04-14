from pathlib import Path
from typing import Callable

from app.config import DEFAULT_END_FRAME, DEFAULT_FPS, SMPL_ROOT

from .interpolation import interpolate_pose_aa
from .phalp_service import run_phalp
from .preview import render_overlay_video, render_skeleton_gif
from .smoothing import smooth_pose_aa
from .smpl_to_bvh_service import convert_pkl_to_bvh
from .track_extractor import extract_longest_track, extract_track, list_tracks_meta


def step1_detect(
    video_path: str | Path,
    output_dir: str | Path,
    start_frame: int = 0,
    end_frame: int = DEFAULT_END_FRAME,
    frame_step: int = 1,
    progress_cb: Callable[[float], None] | None = None,
) -> dict:
    """跑 PHALP，回傳 {pkl, tracks, total_frames, frame_step}。overlay 由 gpu_worker 另外呼叫。"""
    video_path = Path(video_path).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    pkl_path = run_phalp(
        video_path, output_dir / "phalp",
        start_frame=start_frame, end_frame=end_frame,
        every_x_frame=frame_step,
        progress_cb=progress_cb,
    )
    tracks, total_frames = list_tracks_meta(pkl_path)
    return {"pkl": pkl_path, "tracks": tracks, "total_frames": total_frames, "frame_step": frame_step}


def step1b_overlay(
    pkl_path: str | Path,
    output_dir: str | Path,
    fps: float = DEFAULT_FPS,
    progress_cb: Callable[[float], None] | None = None,
) -> Path:
    pkl_path = Path(pkl_path)
    output_dir = Path(output_dir)
    overlay_path = output_dir / "overlay.mp4"
    render_overlay_video(
        pkl_path=pkl_path, output_mp4=overlay_path, fps=fps, progress_cb=progress_cb,
    )
    return overlay_path


def step2_convert(
    pkl_path: str | Path,
    output_bvh: str | Path,
    track_id: int,
    fps: int = DEFAULT_FPS,
    smoothing: bool = False,
    interpolate: bool = False,
    frame_step: int = 1,
) -> Path:
    pose_aa = extract_track(pkl_path, track_id)
    if smoothing:
        pose_aa = smooth_pose_aa(pose_aa)
    if interpolate and frame_step > 1:
        pose_aa = interpolate_pose_aa(pose_aa, factor=frame_step)
    output_bvh = Path(output_bvh).resolve()
    convert_pkl_to_bvh(
        pkl_path=pkl_path,
        output_bvh=output_bvh,
        smpl_root=SMPL_ROOT,
        fps=fps,
        pose_aa=pose_aa,
    )
    return output_bvh


def run_e2e(
    video_path: str | Path,
    output_dir: str | Path,
    start_frame: int = 0,
    end_frame: int = DEFAULT_END_FRAME,
    fps: int = DEFAULT_FPS,
    preview: bool = True,
    smoothing: bool = False,
) -> dict:
    video_path = Path(video_path).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    phalp_out = output_dir / "phalp"
    pkl_path = run_phalp(video_path, phalp_out, start_frame=start_frame, end_frame=end_frame)

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
