"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  duration: number;
  currentTime: number;
  onSeek?: (t: number) => void;
};

export function PlaybackBar({ duration, currentTime, onSeek }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      if (!onSeek || duration <= 0) return;
      const el = barRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onSeek) return;
      const el = barRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      setDragging(true);
      seekFromEvent(e.clientX);
    },
    [onSeek, seekFromEvent],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      seekFromEvent(e.clientX);
    },
    [dragging, seekFromEvent],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = barRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      setDragging(false);
    },
    [],
  );

  const pct = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) * 100 : 0;

  return (
    <div
      ref={barRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: "relative",
        height: 10,
        padding: "4px 0",
        boxSizing: "content-box",
        background: "#222",
        cursor: onSeek ? "pointer" : "default",
        touchAction: "none",
        userSelect: "none",
      }}
      title={duration > 0 ? `${currentTime.toFixed(1)} / ${duration.toFixed(1)}s` : undefined}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 4,
          bottom: 4,
          width: `${pct}%`,
          background: "#3a6",
          transition: dragging ? "none" : "width 0.08s linear",
          pointerEvents: "none",
        }}
      />
      {onSeek && duration > 0 && (
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#3a6",
            border: "2px solid #fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            transition: dragging ? "none" : "left 0.08s linear",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
