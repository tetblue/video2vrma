from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "vendor"
MODELS = ROOT / "models"
DATA = ROOT / "data"
SMPL_ROOT = DATA / "smpl"
TMP = ROOT / "tmp"

PROJECT_HOME = MODELS / "_home"
PROJECT_IOPATH = MODELS / "iopath_cache"

DEFAULT_FPS = 30
# -1 表示跑整支影片，與 PHALP 的 sentinel 一致（見 vendor/PHALP/phalp/trackers/PHALP.py:173）
DEFAULT_END_FRAME = -1
DEFAULT_START_FRAME = 0

SMOOTHING_WINDOW = 7
SMOOTHING_POLYORDER = 3
