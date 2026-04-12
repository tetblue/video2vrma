"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TrimSlider } from "./TrimSlider";
import { VrmPreview, VrmPreviewHandle } from "./VrmPreview";

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

type TrimConfig = {
  file: File;
  disabled?: boolean;
  onStart: (file: File, startTime: number, endTime: number) => void;
};

type ClipInfo = {
  file: File;
  start: number;
  end: number;
};

type Props = {
  videoUrl: string | null;
  overlayUrl: string | null;
  vrmaBlob: Blob | null;
  vrmUrl: string;
  trim?: TrimConfig | null;
  clip?: ClipInfo | null;
};

export function ReviewPanel({ videoUrl, overlayUrl, vrmaBlob, vrmUrl, trim, clip }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const vrmRef = useRef<VrmPreviewHandle>(null);
  const [playing, setPlaying] = useState(false);

  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const rafRef = useRef<number>(0);

  const localFile = trim?.file ?? clip?.file ?? null;
  const localUrl = useMemo(
    () => (localFile ? URL.createObjectURL(localFile) : null),
    [localFile],
  );
  useEffect(() => {
    return () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [localUrl]);

  const activeVideoSrc = localUrl ?? videoUrl;
  const isTrimming = !!trim;
  const isClipping = !trim && !!clip;
  const clipStart = clip?.start ?? 0;
  const clipEnd = clip?.end ?? 0;

  const onVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration || 0;
    setDuration(dur);
    if (isTrimming) {
      setStartTime(0);
      setEndTime(dur);
      setCurrentTime(0);
    } else if (isClipping) {
      v.currentTime = clipStart;
      setCurrentTime(clipStart);
    }
  }, [isTrimming, isClipping, clipStart]);

  useEffect(() => {
    if (!isTrimming && !isClipping) return;
    const v = videoRef.current;
    if (!v) return;
    const loopStart = isTrimming ? startTime : clipStart;
    const loopEnd = isTrimming ? endTime : clipEnd;
    const tick = () => {
      setCurrentTime(v.currentTime);
      if (playing && v.currentTime >= loopEnd) {
        v.currentTime = loopStart;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isTrimming, isClipping, playing, startTime, endTime, clipStart, clipEnd]);

  const syncPlay = useCallback(() => {
    if (isTrimming || isClipping) {
      const v = videoRef.current;
      if (!v) return;
      const loopStart = isTrimming ? startTime : clipStart;
      const loopEnd = isTrimming ? endTime : clipEnd;
      if (v.currentTime < loopStart || v.currentTime >= loopEnd) {
        v.currentTime = loopStart;
      }
      v.play();
    } else {
      videoRef.current?.play();
      overlayRef.current?.play();
      vrmRef.current?.play();
    }
    setPlaying(true);
  }, [isTrimming, isClipping, startTime, endTime, clipStart, clipEnd]);

  const syncPause = useCallback(() => {
    videoRef.current?.pause();
    if (!isTrimming && !isClipping) {
      overlayRef.current?.pause();
      vrmRef.current?.pause();
    }
    setPlaying(false);
  }, [isTrimming, isClipping]);

  const syncReset = useCallback(() => {
    const resetTo = isTrimming ? startTime : isClipping ? clipStart : 0;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = resetTo;
    }
    if (!isTrimming && !isClipping) {
      if (overlayRef.current) {
        overlayRef.current.pause();
        overlayRef.current.currentTime = 0;
      }
      vrmRef.current?.reset();
    }
    setPlaying(false);
  }, [isTrimming, isClipping, startTime, clipStart]);

  const onVideoEnded = useCallback(() => {
    syncPause();
  }, [syncPause]);

  const onStartChange = useCallback(
    (val: number) => {
      const v = Math.max(0, Math.min(val, endTime - 0.1));
      setStartTime(v);
      const el = videoRef.current;
      if (el && !playing) {
        el.currentTime = v;
        setCurrentTime(v);
      }
    },
    [endTime, playing],
  );

  const onEndChange = useCallback(
    (val: number) => {
      setEndTime(Math.max(startTime + 0.1, Math.min(duration, val)));
    },
    [startTime, duration],
  );

  const onSeek = useCallback((t: number) => {
    const el = videoRef.current;
    if (el) {
      el.currentTime = t;
      setCurrentTime(t);
    }
  }, []);

  const segmentDuration = Math.max(0, endTime - startTime);
  const hasContent = activeVideoSrc || overlayUrl || vrmaBlob;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <button
          onClick={playing ? syncPause : syncPlay}
          disabled={!hasContent}
          style={ctrlBtnStyle}
        >
          {playing ? "⏸ 暫停" : isTrimming || isClipping ? "▶ 預覽片段" : "▶ 同步播放"}
        </button>
        <button onClick={syncReset} disabled={!hasContent} style={ctrlBtnStyle}>
          ⏹ 重置
        </button>
        {isTrimming && trim && (
          <>
            <button
              onClick={() => trim.onStart(trim.file, startTime, endTime)}
              disabled={trim.disabled || segmentDuration < 0.1}
              style={{
                ...startBtnStyle,
                opacity: trim.disabled || segmentDuration < 0.1 ? 0.5 : 1,
              }}
            >
              開始轉換
            </button>
            {duration > 0 && (
              <span style={{ fontSize: "0.8em", color: "#666" }}>
                選取 {fmtTime(segmentDuration)} / 總長 {fmtTime(duration)}
              </span>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        <div style={panelStyle}>
          <div style={labelStyle}>
            {isClipping ? `轉換片段 ${fmtTime(clipStart)} – ${fmtTime(clipEnd)}` : "原始影片"}
          </div>
          {activeVideoSrc ? (
            <>
              <video
                ref={videoRef}
                src={activeVideoSrc}
                onLoadedMetadata={isTrimming || isClipping ? onVideoLoaded : undefined}
                onEnded={onVideoEnded}
                preload="auto"
                playsInline
                muted
                style={mediaStyle}
              />
              {isTrimming && duration > 0 && (
                <TrimSlider
                  duration={duration}
                  startTime={startTime}
                  endTime={endTime}
                  currentTime={currentTime}
                  onStartChange={onStartChange}
                  onEndChange={onEndChange}
                  onSeek={onSeek}
                />
              )}
            </>
          ) : (
            <div style={placeholderStyle}>等待選擇影片…</div>
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

const startBtnStyle: React.CSSProperties = {
  padding: "6px 18px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "0.9em",
  fontWeight: "bold",
};
