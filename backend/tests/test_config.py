from app import config


def test_paths_exist():
    assert config.ROOT.is_dir()
    assert config.VENDOR.is_dir()
    assert config.SMPL_ROOT.is_dir()


def test_defaults():
    assert config.DEFAULT_FPS == 30
    # -1 表示跑整支影片，不再截斷到固定 frame 數
    assert config.DEFAULT_END_FRAME == -1
    assert config.SMOOTHING_WINDOW >= config.SMOOTHING_POLYORDER + 2
