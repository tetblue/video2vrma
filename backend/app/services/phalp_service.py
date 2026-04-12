import importlib.util
import os
import pickle
from pathlib import Path

from . import vendor_paths  # noqa: F401  (side-effect: sys.path + HOME + stubs)

ROOT = vendor_paths.ROOT
_DEMO_PY = vendor_paths.VENDOR / "PHALP" / "scripts" / "demo.py"


def _load_phalp_demo():
    spec = importlib.util.spec_from_file_location("phalp_demo", _DEMO_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _patch_hmr2_skip_renderer() -> None:
    # HMR2.__init__ 預設 init_renderer=True 會實例化 SkeletonRenderer / MeshRenderer，
    # 後者會真的呼叫 pyrender.OffscreenRenderer()，即使我們有 stub 也會失敗。
    # 直接在 class 上 patch 掉 __init__ 強制 init_renderer=False。
    import hmr2.models.hmr2 as _hmr2_mod

    if getattr(_hmr2_mod.HMR2.__init__, "_v2v_patched", False):
        return

    _orig_init = _hmr2_mod.HMR2.__init__

    def _patched_init(self, cfg, init_renderer: bool = False):
        _orig_init(self, cfg, init_renderer=False)

    _patched_init._v2v_patched = True  # type: ignore[attr-defined]
    _hmr2_mod.HMR2.__init__ = _patched_init


def _convert_py2_smpl_to_py3(src: Path, dst: Path) -> None:
    import dill  # noqa: F401
    try:
        dill._dill._reverse_typemap["ObjectType"] = object  # type: ignore[attr-defined]
    except Exception:
        pass
    dst.parent.mkdir(parents=True, exist_ok=True)
    with open(src, "rb") as f:
        loaded = pickle.load(f, encoding="latin1")
    with open(dst, "wb") as f:
        pickle.dump(loaded, f)


def _prepopulate_smpl_caches() -> None:
    # 既 PHALP 又 4D-Humans 各自需要 SMPL_NEUTRAL.pkl 在自己的 cache 路徑下，
    # 且它們預設會用 wget / download 腳本，在 Windows 跑不起來。
    # 我們在 data/smpl/ 已有合法的 py2 pkl，直接轉好放到兩個 cache 位置。
    src = ROOT / "data" / "smpl" / "basicmodel_neutral_lbs_10_207_0_v1.1.0.pkl"
    if not src.exists():
        raise FileNotFoundError(
            f"SMPL neutral model not found at {src}; cannot pre-populate caches"
        )

    home = Path(os.environ["HOME"])
    targets = [
        home / ".cache" / "phalp" / "3D" / "models" / "smpl" / "SMPL_NEUTRAL.pkl",
        home / ".cache" / "4DHumans" / "data" / "smpl" / "SMPL_NEUTRAL.pkl",
    ]
    for target in targets:
        if not target.exists():
            _convert_py2_smpl_to_py3(src, target)


def resolve_phalp_frame_range(
    start_frame: int | None = None,
    end_frame: int | None = None,
) -> tuple[int, int]:
    """把 user-facing 的 start/end_frame 換成 PHALP 兩個 cfg block 共用的 (start, end)。

    PHALP 用 -1 當 sentinel：phalp.start_frame == -1 會直接用整段 frame list
    （見 vendor/PHALP/phalp/trackers/PHALP.py:173），video.end_frame == -1 會
    讓 extract_frames 不卡上限（utils/utils.py:175）。任何 <0 / None 都當作
    「跑整支影片」。
    """
    start = -1 if (start_frame is None or start_frame <= 0) else start_frame
    end = -1 if (end_frame is None or end_frame < 0) else end_frame
    return start, end


def run_phalp(
    video_path: str | Path,
    output_dir: str | Path,
    start_frame: int = -1,
    end_frame: int = -1,
) -> Path:
    video_path = Path(video_path).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    _prepopulate_smpl_caches()
    phalp_demo = _load_phalp_demo()
    _patch_hmr2_skip_renderer()
    from omegaconf import OmegaConf

    vid_start, vid_end = resolve_phalp_frame_range(start_frame, end_frame)

    cfg = OmegaConf.structured(phalp_demo.Human4DConfig())
    cfg.video.source = video_path.as_posix()
    cfg.video.output_dir = output_dir.as_posix()
    cfg.video.base_path = video_path.parent.as_posix()
    cfg.video.extract_video = True
    # video.* 用絕對幀索引控制 extract_frames 提取範圍
    cfg.video.start_frame = vid_start
    cfg.video.end_frame = vid_end
    # phalp.* 設 -1 表示不對提取後的 list 二次裁切
    # （PHALP.py:173 會用 list slice，若用絕對索引會超出範圍）
    cfg.phalp.start_frame = -1
    cfg.phalp.end_frame = -1
    cfg.render.enable = False
    cfg.overwrite = False
    cfg.post_process.apply_smoothing = False
    cfg.detect_shots = False

    tracker = phalp_demo.HMR2_4dhuman(cfg)

    import torch
    _diag_modules = {
        "HMAR": getattr(tracker, "HMAR", None),
        "HMAR.model (hmr2)": getattr(getattr(tracker, "HMAR", None), "model", None),
        "HMAR.hmar_old": getattr(getattr(tracker, "HMAR", None), "hmar_old", None),
        "pose_predictor": getattr(tracker, "pose_predictor", None),
    }
    print("[device] tracker.device =", tracker.device)
    for name, mod in _diag_modules.items():
        if mod is None:
            print(f"[device] {name}: None")
            continue
        try:
            first_param = next(mod.parameters(), None)
            dev = first_param.device if first_param is not None else "no-params"
        except Exception as exc:
            dev = f"error: {exc}"
        print(f"[device] {name}: {dev}")
    print(f"[device] cuda mem_allocated={torch.cuda.memory_allocated()/1e6:.1f}MB")

    tracker.track()

    video_seq = Path(video_path).stem
    pkl_path = output_dir / "results" / f"demo_{video_seq}.pkl"
    if not pkl_path.exists():
        raise FileNotFoundError(f"PHALP did not produce expected pkl at {pkl_path}")
    return pkl_path
