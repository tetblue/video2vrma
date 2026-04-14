"use client";

import { useEffect, useState } from "react";

type Props = {
  disabled?: boolean;
  defaultFps?: number;
  nativeFps?: number;
  frameStep?: number;
  onConvert: (opts: { fps: number; smoothing: boolean; interpolate: boolean }) => void;
};

export function ConversionPanel({
  disabled,
  defaultFps = 30,
  nativeFps,
  frameStep = 1,
  onConvert,
}: Props) {
  const [fps, setFps] = useState(defaultFps);
  const [smoothing, setSmoothing] = useState(false);
  const [interpolate, setInterpolate] = useState(false);
  const canInterpolate = frameStep > 1;

  // 勾選插值時自動把 FPS 升到原生幀率；取消時退回偵測 fps
  useEffect(() => {
    if (canInterpolate && interpolate && nativeFps) {
      setFps(nativeFps);
    } else {
      setFps(defaultFps);
    }
  }, [canInterpolate, interpolate, nativeFps, defaultFps]);

  // 沒跳幀時 interpolate 沒意義，強制 false
  useEffect(() => {
    if (!canInterpolate && interpolate) setInterpolate(false);
  }, [canInterpolate, interpolate]);

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
      {canInterpolate && (
        <label style={{ fontSize: "0.9em" }}>
          <input
            type="checkbox"
            checked={interpolate}
            disabled={disabled}
            onChange={(e) => setInterpolate(e.target.checked)}
            style={{ marginRight: 4 }}
          />
          SLERP 插值補幀
          {nativeFps ? `（→ ${nativeFps} fps）` : ""}
        </label>
      )}
      <button
        onClick={() => onConvert({ fps, smoothing, interpolate: canInterpolate && interpolate })}
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
