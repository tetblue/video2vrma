import os
import sys
import types

from app.config import MODELS, PROJECT_HOME, PROJECT_IOPATH, ROOT, VENDOR  # noqa: F401

# 把 PHALP / 4D-Humans / detectron2 的 cache 都指到專案 models/ 下，避免每次
# 重新下載，也讓模型檔跟專案打包在一起。HOME 的 override 只影響此 python
# 進程，不是系統全域。
PROJECT_HOME.mkdir(parents=True, exist_ok=True)
PROJECT_IOPATH.mkdir(parents=True, exist_ok=True)
os.environ["HOME"] = str(PROJECT_HOME)
os.environ["FVCORE_CACHE"] = str(PROJECT_IOPATH)


def _ensure_hmr2_download_marker() -> None:
    # hmr2.models.download_models 只檢查 tarball 檔案存在與否決定要不要下載，
    # 下載後立刻解壓。migration 把已解壓的 2.7GB tarball 刪掉節省空間，因此
    # 這裡在解壓完成的前提下補一個 0 byte 佔位檔，避免每次重新下載。
    flag = PROJECT_HOME / ".cache" / "4DHumans" / "logs" / "train" / "multiruns" / "hmr2" / "0" / "model_config.yaml"
    if not flag.exists():
        return
    marker = PROJECT_HOME / ".cache" / "4DHumans" / "hmr2_data.tar.gz"
    if not marker.exists():
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch()


_ensure_hmr2_download_marker()

_PATHS = [
    VENDOR / "PHALP",
    VENDOR / "4d-humans",
    VENDOR / "smpl2bvh",
]

for p in _PATHS:
    s = str(p)
    if s not in sys.path:
        sys.path.insert(0, s)


class _PyrenderNoop:
    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return _PyrenderNoop()

    def __getattr__(self, name):
        return _PyrenderNoop()


def _stub_pyrender() -> None:
    # Windows 沒有 libEGL，pyrender / OpenGL 在 import 時會炸。
    # Phase 1 不需要 render，用 permissive 的 stub 把 pyrender 整個蓋掉，
    # 讓 hmr2 / phalp 內凡是 `import pyrender` 都直接綁到 stub。
    if "pyrender" in sys.modules:
        return
    stub = types.ModuleType("pyrender")
    stub.__file__ = "<v2v pyrender stub>"
    stub.__path__ = []  # type: ignore[attr-defined]

    def _getattr(name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _PyrenderNoop

    stub.__getattr__ = _getattr  # type: ignore[attr-defined]
    sys.modules["pyrender"] = stub


def _stub_phalp_renderer() -> None:
    # PHALP 的 phalp.visualize.py_renderer 也會強制 EGL，同樣攔截。
    key = "phalp.visualize.py_renderer"
    if key in sys.modules:
        return
    stub = types.ModuleType(key)
    stub.Renderer = _PyrenderNoop
    sys.modules[key] = stub


def _stub_neural_renderer() -> None:
    # neural_renderer 是過時套件，Windows 沒 wheel。
    # PHALP 的 HMR2023TextureSampler 只用它算 UV texture 的 depth visibility。
    # Phase 1 只需要 SMPL 參數（from model_out['pred_smpl_params']），
    # uv_image 不會被我們消費，depth 回傳一個巨大常數讓 visibility mask 全部為 True 即可。
    if "neural_renderer" in sys.modules:
        return
    stub = types.ModuleType("neural_renderer")
    stub.__file__ = "<v2v neural_renderer stub>"

    class _NRRenderer:
        def __init__(self, **kwargs):
            self.image_size = kwargs.get("image_size", 256)

        def __call__(self, vertices, faces, mode="depth", K=None, R=None, t=None, **kwargs):
            import torch

            b = vertices.shape[0]
            h = w = self.image_size
            return torch.full((b, h, w), 1e6, dtype=vertices.dtype, device=vertices.device)

    stub.Renderer = _NRRenderer
    sys.modules["neural_renderer"] = stub


def _patch_torch_load_weights_only() -> None:
    # PyTorch 2.6+ 預設 torch.load(weights_only=True)，會擋掉含
    # omegaconf.DictConfig 的 Lightning checkpoint（4D-Humans 就是）。
    # 我們在 local trusted 環境下，把預設回到 False。
    import torch

    if getattr(torch.load, "_v2v_patched", False):
        return
    _orig = torch.load

    def _patched(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return _orig(*args, **kwargs)

    _patched._v2v_patched = True  # type: ignore[attr-defined]
    torch.load = _patched


_stub_pyrender()
_stub_phalp_renderer()
_stub_neural_renderer()
_patch_torch_load_weights_only()
