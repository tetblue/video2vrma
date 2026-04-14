"use client";

import { useCallback, useState } from "react";

import { MAX_UPLOAD_BYTES, formatMaxUploadSize } from "@/lib/uploadLimits";

const ALLOWED = [".mp4", ".mov", ".avi", ".mkv", ".webm"];

type Props = {
  disabled?: boolean;
  onFileSelected: (file: File) => void;
};

export function VideoUploader({ disabled, onFileSelected }: Props) {
  const [error, setError] = useState<string | null>(null);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const file = e.target.files?.[0];
      if (!file) return;
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED.includes(ext)) {
        setError(`不支援的格式 ${ext}`);
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        const sizeMb = Math.round(file.size / (1024 * 1024));
        setError(`檔案過大 (${sizeMb} MB)，上限為 ${formatMaxUploadSize()}`);
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected],
  );

  return (
    <div>
      <label>
        <strong>選擇影片：</strong>
        <input
          type="file"
          accept={ALLOWED.join(",")}
          onChange={onChange}
          disabled={disabled}
          style={{ marginLeft: 8 }}
        />
      </label>
      {error && (
        <div style={{ color: "#c33", marginTop: 4, fontSize: "0.9em" }}>{error}</div>
      )}
    </div>
  );
}
