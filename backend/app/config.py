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
DEFAULT_END_FRAME = 300
DEFAULT_START_FRAME = 0

SMOOTHING_WINDOW = 7
SMOOTHING_POLYORDER = 3
