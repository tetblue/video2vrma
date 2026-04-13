// Backend API client。預設打到 localhost:8000，可用
// NEXT_PUBLIC_API_BASE 覆寫。

import { getClientId } from "@/lib/clientId";

const RAW_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE) ||
  "http://localhost:8000";
export const API_BASE = RAW_BASE.replace(/\/+$/, "");

function clientHeaders(): Record<string, string> {
  const id = getClientId();
  return id ? { "X-Client-Id": id } : {};
}

export type TaskStep =
  | "queued"
  | "detecting"
  | "rendering_overlay"
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
  start_frame: number;
};

export type TracksResponse = {
  task_id: string;
  tracks: TrackInfo[];
  detection_fps: number;
  total_frames: number;
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

export async function uploadVideo(
  file: File,
  startTime?: number,
  endTime?: number,
): Promise<{ task_id: string; share_token: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (startTime != null && startTime > 0) fd.append("start_time", String(startTime));
  if (endTime != null && endTime > 0) fd.append("end_time", String(endTime));
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: fd,
    headers: clientHeaders(),
  });
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

export function videoUrl(taskId: string): string {
  return `${API_BASE}/api/tasks/${taskId}/video`;
}

export function overlayUrl(taskId: string): string {
  return `${API_BASE}/api/tasks/${taskId}/overlay`;
}

export function wsUrl(taskId: string): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/api/ws/tasks/${taskId}`;
}

export type SystemStats = {
  cpu_pct: number;
  gpu_name: string | null;
  gpu_util_pct: number | null;
  gpu_mem_used_mb: number | null;
  gpu_mem_total_mb: number | null;
  tasks_queued: number;
  tasks_active: number;
  tasks_total: number;
};

export async function getSystemStats(): Promise<SystemStats> {
  const res = await fetch(`${API_BASE}/api/system/stats`);
  return jsonOrThrow(res);
}

// --- History / Share / Delete ---

export type HistoryItem = {
  task_id: string;
  share_token: string;
  file_name: string;
  status: string;
  created_at: string;
  has_bvh: boolean;
  has_overlay: boolean;
  error: string | null;
};

export async function getHistory(): Promise<HistoryItem[]> {
  const res = await fetch(`${API_BASE}/api/history`, {
    headers: clientHeaders(),
  });
  return jsonOrThrow(res);
}

export type SharedTask = {
  task_id: string;
  file_name: string;
  status: string;
  created_at: string;
  has_bvh: boolean;
  has_overlay: boolean;
  has_video: boolean;
  tracks: TrackInfo[] | null;
  detection_fps: number | null;
  total_frames: number | null;
};

export async function getSharedTask(shareToken: string): Promise<SharedTask> {
  const res = await fetch(`${API_BASE}/api/r/${shareToken}`);
  return jsonOrThrow(res);
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: clientHeaders(),
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}
