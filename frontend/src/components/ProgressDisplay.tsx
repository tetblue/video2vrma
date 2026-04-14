"use client";

import { useEffect, useRef, useState } from "react";

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

const ACTIVE_STEPS: TaskStep[] = ["detecting", "rendering_overlay", "converting"];

export function ProgressDisplay({ step, progress, message, error, fileName }: Props) {
  const idx = step ? STEP_ORDER.indexOf(step) : -1;
  const pct = Math.round(progress * 100);

  const [elapsedSec, setElapsedSec] = useState(0);
  const startRef = useRef<number | null>(null);
  const activeStep = step && ACTIVE_STEPS.includes(step) ? step : null;
  // detect 與 overlay render 視為同一計時階段
  const groupKey = activeStep === "converting" ? "convert" : activeStep ? "detect" : null;

  useEffect(() => {
    if (!groupKey) {
      startRef.current = null;
      setElapsedSec(0);
      return;
    }
    if (startRef.current == null) {
      startRef.current = Date.now();
    }
    const tick = () => {
      if (startRef.current != null) {
        setElapsedSec((Date.now() - startRef.current) / 1000);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [groupKey]);

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
        {groupKey && (
          <span style={{ marginLeft: 8, color: "#888" }}>
            已耗時 {elapsedSec.toFixed(1)}s
          </span>
        )}
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
