from app import config


def test_paths_exist():
    assert config.ROOT.is_dir()
    assert config.VENDOR.is_dir()
    assert config.SMPL_ROOT.is_dir()


def test_defaults():
    assert config.DEFAULT_FPS == 30
    assert config.DEFAULT_END_FRAME > 0
    assert config.SMOOTHING_WINDOW >= config.SMOOTHING_POLYORDER + 2
