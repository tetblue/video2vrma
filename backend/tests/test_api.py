import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


class StubPipeline:
    def __init__(self) -> None:
        self.detect_calls: list = []
        self.convert_calls: list = []

    def step1_detect(self, video_path, output_dir, start_frame=0, end_frame=-1):
        self.detect_calls.append((str(video_path), str(output_dir)))
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        pkl = out_dir / "fake.pkl"
        pkl.write_bytes(b"fake")
        return {
            "pkl": pkl,
            "tracks": [
                {"track_id": 1, "frame_count": 100},
                {"track_id": 2, "frame_count": 30},
            ],
        }

    def step1b_overlay(self, pkl_path, output_dir):
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        overlay = out_dir / "overlay.mp4"
        overlay.write_bytes(b"fake overlay mp4")
        return overlay

    def step2_convert(self, pkl_path, output_bvh, track_id, fps=30, smoothing=False):
        self.convert_calls.append((str(pkl_path), int(track_id), int(fps), bool(smoothing)))
        bvh = Path(output_bvh)
        bvh.parent.mkdir(parents=True, exist_ok=True)
        bvh.write_text("HIERARCHY\nfake bvh\n")
        return bvh


@pytest.fixture
def client_and_stub(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.TMP", tmp_path)
    monkeypatch.setattr("app.main.TMP", tmp_path)
    stub = StubPipeline()
    app = create_app(pipeline_module=stub)
    with TestClient(app) as client:
        yield client, stub


def _wait_for(client, task_id, target_step, max_iters=50):
    for _ in range(max_iters):
        r = client.get(f"/api/tasks/{task_id}/status")
        if r.status_code == 200 and r.json()["status"] == target_step:
            return r.json()
        import time
        time.sleep(0.02)
    raise AssertionError(f"task {task_id} never reached {target_step}; last={r.json()}")


def test_upload_creates_task_and_runs_detect(client_and_stub, tmp_path):
    client, stub = client_and_stub
    fake_mp4 = tmp_path / "in.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post("/api/upload", files={"file": ("in.mp4", f, "video/mp4")})
    assert r.status_code == 200
    task_id = r.json()["task_id"]
    assert task_id

    status = _wait_for(client, task_id, "tracks_ready")
    assert status["progress"] == 1.0
    assert len(stub.detect_calls) == 1


def test_upload_rejects_bad_extension(client_and_stub, tmp_path):
    client, _ = client_and_stub
    bad = tmp_path / "x.txt"
    bad.write_text("hi")
    with bad.open("rb") as f:
        r = client.post("/api/upload", files={"file": ("x.txt", f, "text/plain")})
    assert r.status_code == 400


def test_full_flow_tracks_then_convert_then_download(client_and_stub, tmp_path):
    client, stub = client_and_stub
    fake_mp4 = tmp_path / "in.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        task_id = client.post("/api/upload", files={"file": ("in.mp4", f, "video/mp4")}).json()["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    r = client.get(f"/api/tasks/{task_id}/tracks")
    assert r.status_code == 200
    tracks = r.json()["tracks"]
    assert tracks[0]["track_id"] == 1
    assert tracks[0]["frame_count"] == 100

    r = client.post(
        f"/api/tasks/{task_id}/convert",
        json={"track_id": 1, "fps": 30, "smoothing": False},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "bvh_ready"
    assert len(stub.convert_calls) == 1
    _, called_track, called_fps, called_smooth = stub.convert_calls[0]
    assert (called_track, called_fps, called_smooth) == (1, 30, False)

    r = client.get(f"/api/tasks/{task_id}/download/bvh")
    assert r.status_code == 200
    assert r.content.startswith(b"HIERARCHY")


def test_status_404(client_and_stub):
    client, _ = client_and_stub
    r = client.get("/api/tasks/nope/status")
    assert r.status_code == 404


def test_tracks_409_before_ready(client_and_stub, tmp_path, monkeypatch):
    client, _ = client_and_stub
    # 直接戳 task_manager 建一個 stuck 在 QUEUED 的 task
    tm = client.app.state.task_manager
    tid = tm.create_task("v.mp4")
    r = client.get(f"/api/tasks/{tid}/tracks")
    assert r.status_code == 409


def test_video_and_overlay_endpoints(client_and_stub, tmp_path):
    client, stub = client_and_stub
    fake_mp4 = tmp_path / "in.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        task_id = client.post("/api/upload", files={"file": ("in.mp4", f, "video/mp4")}).json()["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    r = client.get(f"/api/tasks/{task_id}/video")
    assert r.status_code == 200

    r = client.get(f"/api/tasks/{task_id}/overlay")
    assert r.status_code == 200
    assert b"fake overlay mp4" in r.content


def test_system_stats(client_and_stub):
    client, _ = client_and_stub
    r = client.get("/api/system/stats")
    assert r.status_code == 200
    data = r.json()
    assert "cpu_pct" in data
    assert isinstance(data["tasks_queued"], int)
    assert isinstance(data["tasks_total"], int)


def test_websocket_snapshot(client_and_stub, tmp_path):
    client, _ = client_and_stub
    fake_mp4 = tmp_path / "in.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        task_id = client.post("/api/upload", files={"file": ("in.mp4", f, "video/mp4")}).json()["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    with client.websocket_connect(f"/api/ws/tasks/{task_id}") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert snap["task_id"] == task_id
        assert snap["status"] == "tracks_ready"
