// Phase 6c：上傳檔案大小上限（必須與 backend/app/config.py 的 MAX_UPLOAD_BYTES 一致）
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export function formatMaxUploadSize(): string {
  return `${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024 * 1024))} GB`;
}
