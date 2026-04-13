"use client";

import { useCallback, useEffect, useState } from "react";

import {
  HistoryItem,
  deleteTask,
  getHistory,
} from "@/services/apiClient";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: "queued", color: "#888" },
  detecting: { label: "detecting", color: "#e90" },
  rendering_overlay: { label: "overlay", color: "#e90" },
  tracks_ready: { label: "tracks", color: "#39c" },
  converting: { label: "converting", color: "#e90" },
  bvh_ready: { label: "done", color: "#3a6" },
  error: { label: "error", color: "#c33" },
};

type Props = {
  onLoadTask: (taskId: string, fileName: string) => void;
  currentTaskId: string | null;
  refreshKey: number;
};

export function HistoryPanel({ onLoadTask, currentTaskId, refreshKey }: Props) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getHistory());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const handleDelete = useCallback(
    async (taskId: string) => {
      if (!confirm("delete this record?")) return;
      try {
        await deleteTask(taskId);
        setItems((prev) => prev.filter((i) => i.task_id !== taskId));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const handleShare = useCallback((shareToken: string) => {
    const link = `${window.location.origin}/r/${shareToken}`;
    navigator.clipboard.writeText(link).catch(() => {});
    alert(`link copied:\n${link}`);
  }, []);

  if (items.length === 0 && !loading) {
    return <p style={{ color: "#999", fontSize: "0.85em", margin: "8px 0" }}>no history yet</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
      {items.map((item) => {
        const st = STATUS_LABELS[item.status] ?? { label: item.status, color: "#888" };
        const isCurrent = item.task_id === currentTaskId;
        return (
          <div
            key={item.task_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              background: isCurrent ? "#e8f4fd" : "#f9f9f9",
              borderRadius: 4,
              fontSize: "0.85em",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "1px 6px",
                borderRadius: 3,
                background: st.color,
                color: "#fff",
                fontSize: "0.75em",
                fontWeight: "bold",
              }}
            >
              {st.label}
            </span>
            <span style={{ flex: 1, minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.file_name}
            </span>
            <span style={{ color: "#999", fontSize: "0.8em", whiteSpace: "nowrap" }}>
              {relativeTime(item.created_at)}
            </span>
            <button
              onClick={() => onLoadTask(item.task_id, item.file_name)}
              disabled={isCurrent}
              style={smallBtnStyle}
            >
              load
            </button>
            <button onClick={() => handleShare(item.share_token)} style={smallBtnStyle}>
              share
            </button>
            <button
              onClick={() => handleDelete(item.task_id)}
              style={{ ...smallBtnStyle, color: "#c33" }}
            >
              delete
            </button>
          </div>
        );
      })}
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  background: "transparent",
  border: "1px solid #ccc",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: "0.85em",
};
