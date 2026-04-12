from app.services.phalp_service import resolve_phalp_frame_range


def test_negative_means_full_video():
    assert resolve_phalp_frame_range(-1) == (-1, -1)


def test_none_means_full_video():
    assert resolve_phalp_frame_range(None) == (-1, -1)


def test_positive_caps_end_frame():
    assert resolve_phalp_frame_range(120) == (0, 120)
    assert resolve_phalp_frame_range(1) == (0, 1)


def test_zero_treated_as_explicit_zero_range():
    # end_frame=0 是退化情況，當作 explicit 0；不該被 sentinel 吞掉
    assert resolve_phalp_frame_range(0) == (0, 0)
