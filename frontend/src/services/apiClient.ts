// Backend API client (Phase 4 routes)。預設打到 localhost:8000，可用
// NEXT_PUBLIC_API_BASE 覆寫。

const RAW_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) ||
  "http://localhost:8000";
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

export type TaskStep =
  | "queued"
  | "detecting"
  | "tracks_ready"
  | "converting"
  | "bvh_ready"
  | "error";

export type TaskStatus = {
  task_id: string;
  status: TaskStep;
  progress: number;
  message: string;
  error: string | null;
};

export type TrackInfo = {
  track_id: number;
  frame_count: number;
};

export type TracksResponse = {
  task_id: string;
  tracks: TrackInfo[];
};

export type ConvertRequest = {
  track_id: number;
  fps: number;
  smoothing: boolean;
};

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail ?? JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function uploadVideo(file: File): Promise<{ task_id: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: fd });
  return jsonOrThrow(res);
}

export async function getStatus(taskId: string): Promise<TaskStatus> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/status`);
  return jsonOrThrow(res);
}

export async function getTracks(taskId: string): Promise<TracksResponse> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/tracks`);
  return jsonOrThrow(res);
}

export async function postConvert(
  taskId: string,
  body: ConvertRequest,
): Promise<{ task_id: string; status: TaskStep }> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(res);
}

export async function downloadBvhText(taskId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/download/bvh`);
  if (!res.ok) throw new Error(`download bvh failed: ${res.status}`);
  return res.text();
}

export function wsUrl(taskId: string): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/api/ws/tasks/${taskId}`;
}
