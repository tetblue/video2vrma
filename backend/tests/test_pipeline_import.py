def test_pipeline_imports():
    from app.services import pipeline

    assert callable(pipeline.run_e2e)
    sig = pipeline.run_e2e.__annotations__
    assert "smoothing" not in sig or sig.get("smoothing") is bool


def test_services_exports():
    from app.services.smoothing import smooth_pose_aa
    from app.services.smpl_to_bvh_service import convert_pkl_to_bvh
    from app.services.track_extractor import extract_longest_track

    assert callable(smooth_pose_aa)
    assert callable(convert_pkl_to_bvh)
    assert callable(extract_longest_track)
