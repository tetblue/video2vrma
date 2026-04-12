"use client";

import { useCallback, useState } from "react";

import { uploadVideo } from "@/services/apiClient";

const ALLOWED = [".mp4", ".mov", ".avi", ".mkv", ".webm"];

type Props = {
  disabled?: boolean;
  onUploaded: (taskId: string, fileName: string) => void;
};

export function VideoUploader({ disabled, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const file = e.target.files?.[0];
      if (!file) return;
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED.includes(ext)) {
        setError(`不支援的格式 ${ext}`);
        return;
      }
      setBusy(true);
      try {
        const { task_id } = await uploadVideo(file);
        onUploaded(task_id, file.name);
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [onUploaded],
  );

  return (
    <div>
      <label>
        <strong>選擇影片：</strong>
        <input
          type="file"
          accept={ALLOWED.join(",")}
          onChange={onChange}
          disabled={disabled || busy}
          style={{ marginLeft: 8 }}
        />
      </label>
      {busy && <span style={{ marginLeft: 12 }}>上傳中…</span>}
      {error && (
        <div style={{ color: "#c33", marginTop: 4, fontSize: "0.9em" }}>{error}</div>
      )}
    </div>
  );
}
