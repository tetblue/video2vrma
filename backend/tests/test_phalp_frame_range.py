from app.services.phalp_service import resolve_phalp_frame_range


def test_negative_means_full_video():
    assert resolve_phalp_frame_range(end_frame=-1) == (-1, -1)


def test_none_means_full_video():
    assert resolve_phalp_frame_range(end_frame=None) == (-1, -1)


def test_positive_caps_end_frame():
    assert resolve_phalp_frame_range(end_frame=120) == (-1, 120)
    assert resolve_phalp_frame_range(end_frame=1) == (-1, 1)


def test_zero_treated_as_explicit_zero_range():
    # end_frame=0 是退化情況，當作 explicit 0；不該被 sentinel 吞掉
    assert resolve_phalp_frame_range(end_frame=0) == (-1, 0)


def test_start_frame_passed_through():
    assert resolve_phalp_frame_range(start_frame=30, end_frame=120) == (30, 120)


def test_start_frame_zero_or_negative_becomes_sentinel():
    assert resolve_phalp_frame_range(start_frame=0, end_frame=100) == (-1, 100)
    assert resolve_phalp_frame_range(start_frame=-1, end_frame=100) == (-1, 100)


def test_both_none_means_full_video():
    assert resolve_phalp_frame_range() == (-1, -1)
