from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    task_id: str
    share_token: str


class TaskStatus(BaseModel):
    task_id: str
    status: str
    progress: float
    message: str
    error: str | None = None


class TrackInfo(BaseModel):
    track_id: int
    frame_count: int
    start_frame: int = 0


class TracksResponse(BaseModel):
    task_id: str
    tracks: list[TrackInfo]
    detection_fps: int
    total_frames: int


class ConvertRequest(BaseModel):
    track_id: int
    fps: int = Field(default=30, ge=1, le=240)
    smoothing: bool = False


class ConvertResponse(BaseModel):
    task_id: str
    status: str


class HistoryItem(BaseModel):
    task_id: str
    share_token: str
    file_name: str
    status: str
    created_at: str
    has_bvh: bool
    has_overlay: bool
    error: str | None = None


class SharedTaskResponse(BaseModel):
    task_id: str
    file_name: str
    status: str
    created_at: str
    has_bvh: bool
    has_overlay: bool
    has_video: bool
    tracks: list[TrackInfo] | None = None
    detection_fps: int | None = None
    total_frames: int | None = None
