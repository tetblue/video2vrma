"use client";

import { TaskStep } from "@/services/apiClient";

const STEP_LABELS: Record<TaskStep, string> = {
  queued: "排隊中",
  detecting: "PHALP 偵測中",
  rendering_overlay: "骨架 Overlay 產生中",
  tracks_ready: "等待選擇 track",
  converting: "BVH 轉換中",
  bvh_ready: "BVH 完成",
  error: "錯誤",
};

const STEP_ORDER: TaskStep[] = [
  "queued",
  "detecting",
  "rendering_overlay",
  "tracks_ready",
  "converting",
  "bvh_ready",
];

type Props = {
  step: TaskStep | null;
  progress: number;
  message: string;
  error: string | null;
  fileName?: string | null;
};

export function ProgressDisplay({ step, progress, message, error, fileName }: Props) {
  const idx = step ? STEP_ORDER.indexOf(step) : -1;
  const pct = Math.round(progress * 100);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {STEP_ORDER.map((s, i) => {
          const active = i === idx;
          const done = idx >= 0 && i < idx;
          return (
            <div
              key={s}
              style={{
                flex: 1,
                padding: "4px 6px",
                borderRadius: 3,
                background: active ? "#3a6" : done ? "#cce4d7" : "#eee",
                color: active ? "#fff" : "#333",
                fontSize: "0.8em",
                textAlign: "center",
              }}
            >
              {STEP_LABELS[s]}
            </div>
          );
        })}
      </div>
      <div style={{ height: 6, background: "#eee", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: step === "error" ? "#c33" : "#3a6",
            transition: "width 0.3s",
          }}
        />
      </div>
      <div style={{ marginTop: 6, fontSize: "0.85em", color: "#555" }}>
        {fileName && <strong style={{ marginRight: 6 }}>{fileName}</strong>}
        {step ? STEP_LABELS[step] : "等待中"} — {message || `${pct}%`}
      </div>
      {error && (
        <pre
          style={{
            color: "#c33",
            background: "#fee",
            padding: 8,
            marginTop: 8,
            fontSize: "0.85em",
            overflow: "auto",
          }}
        >
          {error}
        </pre>
      )}
    </div>
  );
}
