"use client";

import { useState } from "react";

type Props = {
  disabled?: boolean;
  onConvert: (opts: { fps: number; smoothing: boolean }) => void;
};

export function ConversionPanel({ disabled, onConvert }: Props) {
  const [fps, setFps] = useState(30);
  const [smoothing, setSmoothing] = useState(false);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ fontSize: "0.9em" }}>
        FPS：
        <input
          type="number"
          value={fps}
          min={1}
          max={240}
          disabled={disabled}
          onChange={(e) => setFps(Math.max(1, Math.min(240, Number(e.target.value) || 30)))}
          style={{ width: 60, marginLeft: 4 }}
        />
      </label>
      <label style={{ fontSize: "0.9em" }}>
        <input
          type="checkbox"
          checked={smoothing}
          disabled={disabled}
          onChange={(e) => setSmoothing(e.target.checked)}
          style={{ marginRight: 4 }}
        />
        套用 Savitzky-Golay 平滑
      </label>
      <button
        onClick={() => onConvert({ fps, smoothing })}
        disabled={disabled}
        style={{
          padding: "6px 16px",
          background: disabled ? "#ccc" : "#3a6",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        轉成 BVH
      </button>
    </div>
  );
}
