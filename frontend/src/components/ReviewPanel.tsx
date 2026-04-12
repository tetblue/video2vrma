"use client";

import { useCallback, useRef, useState } from "react";

import { VrmPreview, VrmPreviewHandle } from "./VrmPreview";

type Props = {
  videoUrl: string | null;
  overlayUrl: string | null;
  vrmaBlob: Blob | null;
  vrmUrl: string;
};

export function ReviewPanel({ videoUrl, overlayUrl, vrmaBlob, vrmUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const vrmRef = useRef<VrmPreviewHandle>(null);
  const [playing, setPlaying] = useState(false);

  const syncPlay = useCallback(() => {
    videoRef.current?.play();
    overlayRef.current?.play();
    vrmRef.current?.play();
    setPlaying(true);
  }, []);

  const syncPause = useCallback(() => {
    videoRef.current?.pause();
    overlayRef.current?.pause();
    vrmRef.current?.pause();
    setPlaying(false);
  }, []);

  const syncReset = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    if (overlayRef.current) {
      overlayRef.current.pause();
      overlayRef.current.currentTime = 0;
    }
    vrmRef.current?.reset();
    setPlaying(false);
  }, []);

  const onVideoEnded = useCallback(() => {
    syncPause();
  }, [syncPause]);

  const hasContent = videoUrl || overlayUrl || vrmaBlob;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <button
          onClick={playing ? syncPause : syncPlay}
          disabled={!hasContent}
          style={ctrlBtnStyle}
        >
          {playing ? "⏸ 暫停" : "▶ 同步播放"}
        </button>
        <button onClick={syncReset} disabled={!hasContent} style={ctrlBtnStyle}>
          ⏹ 重置
        </button>
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <div style={panelStyle}>
          <div style={labelStyle}>原始影片</div>
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              onEnded={onVideoEnded}
              preload="auto"
              playsInline
              muted
              style={mediaStyle}
            />
          ) : (
            <div style={placeholderStyle}>等待上傳…</div>
          )}
        </div>

        <div style={panelStyle}>
          <div style={labelStyle}>骨架 Overlay</div>
          {overlayUrl ? (
            <video
              ref={overlayRef}
              src={overlayUrl}
              preload="auto"
              playsInline
              muted
              style={mediaStyle}
            />
          ) : (
            <div style={placeholderStyle}>等待偵測完成…</div>
          )}
        </div>

        <div style={panelStyle}>
          <div style={labelStyle}>VRM 動畫</div>
          <VrmPreview
            ref={vrmRef}
            vrmUrl={vrmUrl}
            vrmaBlob={vrmaBlob}
            autoPlay={false}
          />
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "1px solid #444",
  borderRadius: 4,
  overflow: "hidden",
};

const labelStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "#333",
  color: "#fff",
  fontSize: "0.8em",
  textAlign: "center",
};

const mediaStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "auto",
};

const placeholderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: 200,
  color: "#888",
  fontSize: "0.9em",
  background: "#f5f5f5",
};

const ctrlBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#3a6",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "0.9em",
};
