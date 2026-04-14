import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


class StubPipeline:
    def __init__(self) -> None:
        self.detect_calls: list = []
        self.convert_calls: list = []

    def step1_detect(self, video_path, output_dir, start_frame=0, end_frame=-1, frame_step=1, progress_cb=None):
        self.detect_calls.append((str(video_path), str(output_dir), int(frame_step)))
        if progress_cb:
            progress_cb(0.5)
            progress_cb(1.0)
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        pkl = out_dir / "fake.pkl"
        pkl.write_bytes(b"fake")
        return {
            "pkl": pkl,
            "tracks": [
                {"track_id": 1, "frame_count": 100, "start_frame": 0},
                {"track_id": 2, "frame_count": 30, "start_frame": 100},
            ],
            "total_frames": 130,
        }

    def step1b_overlay(self, pkl_path, output_dir, fps=30, progress_cb=None):
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        overlay = out_dir / "overlay.mp4"
        overlay.write_bytes(b"fake overlay mp4")
        if progress_cb:
            progress_cb(1.0)
        return overlay

    def step2_convert(self, pkl_path, output_bvh, track_id, fps=30, smoothing=False, interpolate=False, frame_step=1):
        self.convert_calls.append(
            (str(pkl_path), int(track_id), int(fps), bool(smoothing), bool(interpolate), int(frame_step))
        )
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


def _upload(client, tmp_path, filename="in.mp4", client_id="test-client-1"):
    fake_mp4 = tmp_path / filename
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post(
            "/api/upload",
            files={"file": (filename, f, "video/mp4")},
            headers={"X-Client-Id": client_id},
        )
    assert r.status_code == 200
    return r.json()


def test_upload_creates_task_and_runs_detect(client_and_stub, tmp_path):
    client, stub = client_and_stub
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    assert task_id
    assert data["share_token"]

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
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
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
    _, called_track, called_fps, called_smooth, *_ = stub.convert_calls[0]
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
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
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
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    with client.websocket_connect(f"/api/ws/tasks/{task_id}") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert snap["task_id"] == task_id
        assert snap["status"] == "tracks_ready"


# --- Phase 7a: persistence tests ---

def test_upload_returns_share_token(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path)
    assert "share_token" in data
    assert len(data["share_token"]) == 12


def test_history_json_created_after_detect(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    history_file = tmp_path / "history" / f"{task_id}.json"
    assert history_file.exists()
    record = json.loads(history_file.read_text(encoding="utf-8"))
    assert record["task_id"] == task_id
    assert record["status"] == "tracks_ready"
    assert record["client_id"] == "test-client-1"
    assert record["file_name"] == "in.mp4"
    assert record["share_token"] == data["share_token"]


def test_history_json_updated_after_convert(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    client.post(f"/api/tasks/{task_id}/convert", json={"track_id": 1, "fps": 30, "smoothing": False})

    history_file = tmp_path / "history" / f"{task_id}.json"
    record = json.loads(history_file.read_text(encoding="utf-8"))
    assert record["status"] == "bvh_ready"
    assert record["bvh_path"] is not None


def test_share_index_lookup(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    share_token = data["share_token"]
    _wait_for(client, task_id, "tracks_ready")

    tm = client.app.state.task_manager
    task = tm.get_by_share_token(share_token)
    assert task is not None
    assert task.task_id == task_id


def test_delete_task(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    share_token = data["share_token"]
    _wait_for(client, task_id, "tracks_ready")

    tm = client.app.state.task_manager
    assert tm.delete_task(task_id) is True
    assert tm.get(task_id) is None
    assert tm.get_by_share_token(share_token) is None
    assert not (tmp_path / "history" / f"{task_id}.json").exists()


def test_history_list(client_and_stub, tmp_path):
    client, _ = client_and_stub
    _upload(client, tmp_path, "a.mp4", "user-A")
    _upload(client, tmp_path, "b.mp4", "user-A")
    _upload(client, tmp_path, "c.mp4", "user-B")

    r = client.get("/api/history", headers={"X-Client-Id": "user-A"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    assert all(i["file_name"] in ("a.mp4", "b.mp4") for i in items)

    r = client.get("/api/history", headers={"X-Client-Id": "user-B"})
    assert len(r.json()) == 1

    r = client.get("/api/history")
    assert r.json() == []


def test_shared_task_endpoint(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    share_token = data["share_token"]
    _wait_for(client, task_id, "tracks_ready")

    r = client.get(f"/api/r/{share_token}")
    assert r.status_code == 200
    body = r.json()
    assert body["task_id"] == task_id
    assert body["file_name"] == "in.mp4"
    assert body["status"] == "tracks_ready"
    assert body["has_overlay"] is True
    assert body["has_video"] is True
    assert body["tracks"] is not None

    r = client.get("/api/r/nonexistent123")
    assert r.status_code == 404


def test_delete_task_api(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path, client_id="owner-1")
    task_id = data["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    # wrong client_id → 403
    r = client.delete(f"/api/tasks/{task_id}", headers={"X-Client-Id": "other"})
    assert r.status_code == 403

    # no client_id → 403
    r = client.delete(f"/api/tasks/{task_id}")
    assert r.status_code == 403

    # correct client_id → success
    r = client.delete(f"/api/tasks/{task_id}", headers={"X-Client-Id": "owner-1"})
    assert r.status_code == 200
    assert r.json()["deleted"] == task_id

    # already deleted → 404
    r = client.get(f"/api/tasks/{task_id}/status")
    assert r.status_code == 404


def test_history_has_elapsed_times(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path, client_id="elapsed-user")
    task_id = data["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    client.post(f"/api/tasks/{task_id}/convert", json={"track_id": 1, "fps": 30, "smoothing": False})

    r = client.get("/api/history", headers={"X-Client-Id": "elapsed-user"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    it = items[0]
    assert it["detect_elapsed_sec"] is not None
    assert it["detect_elapsed_sec"] >= 0
    assert it["convert_elapsed_sec"] is not None
    assert it["convert_elapsed_sec"] >= 0
    assert "clip_start_time" in it
    assert "clip_end_time" in it


def test_client_id_auto_generated_when_missing(client_and_stub, tmp_path):
    client, _ = client_and_stub
    fake_mp4 = tmp_path / "no_header.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post("/api/upload", files={"file": ("no_header.mp4", f, "video/mp4")})
    assert r.status_code == 200
    task_id = r.json()["task_id"]
    tm = client.app.state.task_manager
    task = tm.get(task_id)
    assert task.client_id  # auto-generated, non-empty


def test_upload_persists_clip_times(client_and_stub, tmp_path):
    client, _ = client_and_stub
    fake_mp4 = tmp_path / "clip.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post(
            "/api/upload",
            files={"file": ("clip.mp4", f, "video/mp4")},
            data={"start_time": "1.5", "end_time": "3.5"},
            headers={"X-Client-Id": "clip-user"},
        )
    assert r.status_code == 200
    task_id = r.json()["task_id"]
    share_token = r.json()["share_token"]

    tm = client.app.state.task_manager
    task = tm.get(task_id)
    assert task.clip_start_time == 1.5
    assert task.clip_end_time == 3.5

    _wait_for(client, task_id, "tracks_ready")
    r = client.get(f"/api/r/{share_token}")
    assert r.status_code == 200
    body = r.json()
    assert body["clip_start_time"] == 1.5
    assert body["clip_end_time"] == 3.5


def test_converted_track_id_persisted(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path, client_id="track-user")
    task_id = data["task_id"]
    share_token = data["share_token"]
    _wait_for(client, task_id, "tracks_ready")

    # before convert: converted_track_id is None
    r = client.get("/api/history", headers={"X-Client-Id": "track-user"})
    assert r.json()[0]["converted_track_id"] is None

    # convert track 2
    r = client.post(f"/api/tasks/{task_id}/convert", json={"track_id": 2, "fps": 30, "smoothing": False})
    assert r.status_code == 200

    # history should record track_id=2
    r = client.get("/api/history", headers={"X-Client-Id": "track-user"})
    assert r.json()[0]["converted_track_id"] == 2

    # shared endpoint too
    r = client.get(f"/api/r/{share_token}")
    assert r.json()["converted_track_id"] == 2

    # persisted on disk
    record = json.loads((tmp_path / "history" / f"{task_id}.json").read_text(encoding="utf-8"))
    assert record["converted_track_id"] == 2


def test_convert_request_interpolate_flag_propagates(client_and_stub, tmp_path):
    client, stub = client_and_stub
    fake_mp4 = tmp_path / "interp.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post(
            "/api/upload",
            files={"file": ("interp.mp4", f, "video/mp4")},
            data={"frame_step": "3"},
            headers={"X-Client-Id": "interp-user"},
        )
    task_id = r.json()["task_id"]
    _wait_for(client, task_id, "tracks_ready")

    r = client.post(
        f"/api/tasks/{task_id}/convert",
        json={"track_id": 1, "fps": 30, "smoothing": False, "interpolate": True},
    )
    assert r.status_code == 200
    # step2_convert 應收到 interpolate=True 與 frame_step=3
    _, _, _, _, called_interp, called_step = stub.convert_calls[-1]
    assert called_interp is True
    assert called_step == 3


def test_throttled_progress_callback():
    from app.services.preview import _throttled

    calls: list[float] = []
    cb = _throttled(lambda p: calls.append(p), min_delta=0.1, min_interval=10.0)
    # 0.0 first pass, 0.05 < 0.1 delta skipped, 0.11 passes, 0.15 skipped, 1.0 forced
    cb(0.0)
    cb(0.05)
    cb(0.11)
    cb(0.15)
    cb(1.0)
    assert calls[0] == 0.0
    assert 0.11 in calls
    assert calls[-1] == 1.0
    assert 0.05 not in calls
    assert 0.15 not in calls


# --- Phase 6c: input validation tests ---

def test_upload_rejects_oversize_content_length(client_and_stub, tmp_path, monkeypatch):
    # 把上限暫時降到 1024 bytes，避免真的產 3 GB 檔
    monkeypatch.setattr("app.routers.upload.MAX_UPLOAD_BYTES", 1024)
    client, _ = client_and_stub
    fake_mp4 = tmp_path / "big.mp4"
    fake_mp4.write_bytes(b"\x00" * 4096)  # 4 KB，> 1024
    with fake_mp4.open("rb") as f:
        r = client.post(
            "/api/upload",
            files={"file": ("big.mp4", f, "video/mp4")},
            # Starlette / httpx TestClient 自動帶 Content-Length
        )
    assert r.status_code == 413
    assert "上限" in r.json()["detail"] or "MB" in r.json()["detail"]


def test_upload_rejects_end_before_start(client_and_stub, tmp_path):
    client, _ = client_and_stub
    fake_mp4 = tmp_path / "clip.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post(
            "/api/upload",
            files={"file": ("clip.mp4", f, "video/mp4")},
            data={"start_time": "5.0", "end_time": "2.0"},
        )
    assert r.status_code == 400
    assert "end_time" in r.json()["detail"]


def test_upload_rejects_invalid_frame_step(client_and_stub, tmp_path):
    client, _ = client_and_stub
    fake_mp4 = tmp_path / "step.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post(
            "/api/upload",
            files={"file": ("step.mp4", f, "video/mp4")},
            data={"frame_step": "7"},  # 不在 {1, 3, 5} 白名單
        )
    assert r.status_code == 400
    assert "frame_step" in r.json()["detail"]


def test_convert_request_rejects_negative_track_id(client_and_stub, tmp_path):
    client, _ = client_and_stub
    data = _upload(client, tmp_path)
    task_id = data["task_id"]
    _wait_for(client, task_id, "tracks_ready")
    r = client.post(
        f"/api/tasks/{task_id}/convert",
        json={"track_id": -1, "fps": 30, "smoothing": False},
    )
    assert r.status_code == 422  # Pydantic validation error


def test_frame_step_parameter(client_and_stub, tmp_path):
    client, stub = client_and_stub
    fake_mp4 = tmp_path / "step.mp4"
    fake_mp4.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    with fake_mp4.open("rb") as f:
        r = client.post(
            "/api/upload",
            files={"file": ("step.mp4", f, "video/mp4")},
            data={"frame_step": "5"},
            headers={"X-Client-Id": "tester"},
        )
    assert r.status_code == 200
    task_id = r.json()["task_id"]

    tm = client.app.state.task_manager
    assert tm.get(task_id).frame_step == 5

    _wait_for(client, task_id, "tracks_ready")
    assert stub.detect_calls[-1][2] == 5  # frame_step passed to pipeline

    r = client.get(f"/api/tasks/{task_id}/tracks")
    assert r.json()["frame_step"] == 5
    # detection_fps 應該是 effective fps（native_fps / frame_step），
    # 不是原始影片 fps。stub mp4 無 header，_probe_fps 預設 30 → 30/5 = 6。
    assert r.json()["detection_fps"] == 6
