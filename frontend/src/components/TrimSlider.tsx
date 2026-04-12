"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  onStartChange: (t: number) => void;
  onEndChange: (t: number) => void;
  onSeek: (t: number) => void;
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const TRACK_H = 32;
const HANDLE_W = 12;
const PLAYHEAD_W = 4;

type DragTarget = "start" | "end" | "playhead" | null;

export function TrimSlider({
  duration,
  startTime,
  endTime,
  currentTime,
  onStartChange,
  onEndChange,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<DragTarget>(null);

  const toFrac = useCallback((t: number) => (duration > 0 ? t / duration : 0), [duration]);
  const fromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return 0;
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return frac * duration;
    },
    [duration],
  );

  const onPointerDown = useCallback(
    (target: DragTarget) => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(target);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const t = fromClientX(e.clientX);
      if (dragging === "start") {
        onStartChange(Math.min(t, endTime - 0.1));
      } else if (dragging === "end") {
        onEndChange(Math.max(t, startTime + 0.1));
      } else if (dragging === "playhead") {
        onSeek(Math.max(startTime, Math.min(endTime, t)));
      }
    },
    [dragging, fromClientX, startTime, endTime, onStartChange, onEndChange, onSeek],
  );

  const onPointerUp = useCallback(() => setDragging(null), []);

  const onTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) return;
      const t = fromClientX(e.clientX);
      if (t >= startTime && t <= endTime) {
        onSeek(t);
      }
    },
    [dragging, fromClientX, startTime, endTime, onSeek],
  );

  const startPct = toFrac(startTime) * 100;
  const endPct = toFrac(endTime) * 100;
  const playPct = toFrac(Math.max(startTime, Math.min(endTime, currentTime))) * 100;

  return (
    <div style={{ padding: "8px 8px 4px", userSelect: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75em", color: "#888", marginBottom: 2 }}>
        <span>{fmtTime(startTime)}</span>
        <span style={{ color: "#2563eb", fontWeight: 600 }}>{fmtTime(currentTime)}</span>
        <span>{fmtTime(endTime)}</span>
      </div>

      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={onTrackClick}
        style={{
          position: "relative",
          height: TRACK_H,
          background: "#ddd",
          borderRadius: 4,
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        {/* inactive regions */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: `${startPct}%`,
            height: "100%",
            background: "rgba(0,0,0,0.25)",
            borderRadius: "4px 0 0 4px",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: `${100 - endPct}%`,
            height: "100%",
            background: "rgba(0,0,0,0.25)",
            borderRadius: "0 4px 4px 0",
            pointerEvents: "none",
          }}
        />

        {/* active region */}
        <div
          style={{
            position: "absolute",
            left: `${startPct}%`,
            width: `${endPct - startPct}%`,
            top: 0,
            height: "100%",
            background: "rgba(37,99,235,0.15)",
            pointerEvents: "none",
          }}
        />

        {/* start handle */}
        <div
          onPointerDown={onPointerDown("start")}
          style={{
            position: "absolute",
            left: `calc(${startPct}% - ${HANDLE_W / 2}px)`,
            top: 0,
            width: HANDLE_W,
            height: "100%",
            background: dragging === "start" ? "#1d4ed8" : "#2563eb",
            borderRadius: 3,
            cursor: "ew-resize",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 2, height: 14, background: "rgba(255,255,255,0.7)", borderRadius: 1 }} />
        </div>

        {/* end handle */}
        <div
          onPointerDown={onPointerDown("end")}
          style={{
            position: "absolute",
            left: `calc(${endPct}% - ${HANDLE_W / 2}px)`,
            top: 0,
            width: HANDLE_W,
            height: "100%",
            background: dragging === "end" ? "#1d4ed8" : "#2563eb",
            borderRadius: 3,
            cursor: "ew-resize",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 2, height: 14, background: "rgba(255,255,255,0.7)", borderRadius: 1 }} />
        </div>

        {/* playhead */}
        <div
          onPointerDown={onPointerDown("playhead")}
          style={{
            position: "absolute",
            left: `calc(${playPct}% - ${PLAYHEAD_W / 2}px)`,
            top: -3,
            width: PLAYHEAD_W,
            height: TRACK_H + 6,
            background: dragging === "playhead" ? "#dc2626" : "#ef4444",
            borderRadius: 2,
            cursor: "ew-resize",
            zIndex: 4,
            boxShadow: "0 0 3px rgba(0,0,0,0.3)",
          }}
        />
      </div>
    </div>
  );
}
