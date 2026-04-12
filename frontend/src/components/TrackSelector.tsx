"use client";

import { TrackInfo } from "@/services/apiClient";

type Props = {
  tracks: TrackInfo[];
  selected: number | null;
  disabled?: boolean;
  onSelect: (trackId: number) => void;
};

export function TrackSelector({ tracks, selected, disabled, onSelect }: Props) {
  if (tracks.length === 0) {
    return <div style={{ color: "#888" }}>沒有偵測到任何 track</div>;
  }
  return (
    <div>
      <div style={{ marginBottom: 6, fontWeight: 600 }}>選擇要轉換的 track（共 {tracks.length} 個）</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tracks.map((t) => {
          const isSel = t.track_id === selected;
          return (
            <button
              key={t.track_id}
              disabled={disabled}
              onClick={() => onSelect(t.track_id)}
              style={{
                padding: "6px 12px",
                border: isSel ? "2px solid #3a6" : "1px solid #bbb",
                borderRadius: 4,
                background: isSel ? "#e8f5ee" : "#fff",
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: "0.9em",
              }}
            >
              <div style={{ fontWeight: 600 }}>track #{t.track_id}</div>
              <div style={{ fontSize: "0.8em", color: "#666" }}>{t.frame_count} frames</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
