"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PlaybackBar } from "./PlaybackBar";
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
  file?: File;
  url?: string;
  start: number;
  end: number;
};

type TrackTiming = {
  startFrame: number;
  totalFrames: number;
  detectionFps: number;
};

type Props = {
  videoUrl: string | null;
  overlayUrl: string | null;
  vrmaBlob: Blob | null;
  vrmUrl: string;
  trim?: TrimConfig | null;
  clip?: ClipInfo | null;
  trackTiming?: TrackTiming | null;
};

export function ReviewPanel({ videoUrl, overlayUrl, vrmaBlob, vrmUrl, trim, clip, trackTiming }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const vrmRef = useRef<VrmPreviewHandle>(null);
  const [playing, setPlaying] = useState(false);

  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [overlayDuration, setOverlayDuration] = useState(0);
  const [overlayCurrentTime, setOverlayCurrentTime] = useState(0);
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

  const activeVideoSrc = localUrl ?? clip?.url ?? videoUrl;
  const isTrimming = !!trim;
  const clipStart = clip?.start ?? 0;
  const clipEnd = clip?.end ?? 0;
  // 三窗格都有內容時進入完整同步模式（同時仍保留 clip loop）
  const hasAllPanes = !!overlayUrl && !!vrmaBlob;
  const isClipping = !trim && !!clip && !hasAllPanes;
  // 完整同步 + 有 clip 範圍：原始影片需 loop clip，同時 overlay/VRM 也同步
  const isSyncWithClip = !trim && !!clip && hasAllPanes;

  // track 在 overlay 影片中的起始時間（秒）
  const trackOffsetTime = trackTiming && trackTiming.detectionFps > 0
    ? trackTiming.startFrame / trackTiming.detectionFps
    : 0;

  const onVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration || 0;
    setDuration(dur);
    if (isTrimming) {
      setStartTime(0);
      setEndTime(dur);
      setCurrentTime(0);
    } else if (isClipping || isSyncWithClip) {
      v.currentTime = clipStart;
      setCurrentTime(clipStart);
    }
  }, [isTrimming, isClipping, isSyncWithClip, clipStart]);

  useEffect(() => {
    if (!isTrimming && !isClipping && !isSyncWithClip) return;
    const v = videoRef.current;
    if (!v) return;
    const loopStart = isTrimming ? startTime : clipStart;
    const loopEnd = isTrimming ? endTime : clipEnd;
    const tick = () => {
      setCurrentTime(v.currentTime);
      if (playing && v.currentTime >= loopEnd) {
        v.currentTime = loopStart;
        // 同步模式下 overlay / VRM 也要回到開頭
        if (isSyncWithClip) {
          if (overlayRef.current) overlayRef.current.currentTime = 0;
          overlayRef.current?.play();
        }
      }
      // 同步模式下每幀精確同步 VRM 時間（考慮 track offset），並更新 overlay playhead
      if (isSyncWithClip && overlayRef.current) {
        const overlayT = overlayRef.current.currentTime;
        setOverlayCurrentTime(overlayT);
        if (playing) {
          const vrmT = overlayT - trackOffsetTime;
          vrmRef.current?.setTime(vrmT);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isTrimming, isClipping, isSyncWithClip, playing, startTime, endTime, clipStart, clipEnd, trackOffsetTime]);

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
    } else if (isSyncWithClip) {
      // 三窗格同步 + 原始影片 loop clip 範圍
      const v = videoRef.current;
      if (v) {
        if (v.currentTime < clipStart || v.currentTime >= clipEnd) {
          v.currentTime = clipStart;
        }
        v.play();
      }
      overlayRef.current?.play();
      vrmRef.current?.play();
    } else {
      videoRef.current?.play();
      overlayRef.current?.play();
      vrmRef.current?.play();
    }
    setPlaying(true);
  }, [isTrimming, isClipping, isSyncWithClip, startTime, endTime, clipStart, clipEnd]);

  const syncPause = useCallback(() => {
    videoRef.current?.pause();
    if (!isTrimming && !isClipping) {
      overlayRef.current?.pause();
      vrmRef.current?.pause();
    }
    setPlaying(false);
  }, [isTrimming, isClipping, isSyncWithClip]);

  const syncReset = useCallback(() => {
    const resetTo = isTrimming ? startTime : (isClipping || isSyncWithClip) ? clipStart : 0;
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
  }, [isTrimming, isClipping, isSyncWithClip, startTime, clipStart, trackOffsetTime]);

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

  const onOverlayLoaded = useCallback(() => {
    const el = overlayRef.current;
    if (!el) return;
    setOverlayDuration(el.duration || 0);
  }, []);

  const onVideoSeek = useCallback(
    (localT: number) => {
      // localT 是 playhead 上的相對秒數（0 ~ clipEnd-clipStart）
      const v = videoRef.current;
      if (!v) return;
      const absT = clipStart + localT;
      v.currentTime = absT;
      setCurrentTime(absT);
    },
    [clipStart],
  );

  const onOverlaySeek = useCallback(
    (t: number) => {
      const ov = overlayRef.current;
      if (!ov) return;
      ov.currentTime = t;
      setOverlayCurrentTime(t);
      if (isSyncWithClip) {
        vrmRef.current?.setTime(t - trackOffsetTime);
      }
    },
    [isSyncWithClip, trackOffsetTime],
  );

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
            {(isClipping || isSyncWithClip) ? `轉換片段 ${fmtTime(clipStart)} – ${fmtTime(clipEnd)}` : "原始影片"}
          </div>
          {activeVideoSrc ? (
            <>
              <video
                ref={videoRef}
                src={activeVideoSrc}
                onLoadedMetadata={(isTrimming || isClipping || isSyncWithClip) ? onVideoLoaded : undefined}
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
              {isSyncWithClip && clipEnd > clipStart && (
                <PlaybackBar
                  duration={clipEnd - clipStart}
                  currentTime={Math.max(0, currentTime - clipStart)}
                  onSeek={onVideoSeek}
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
            <>
              <video
                ref={overlayRef}
                src={overlayUrl}
                onLoadedMetadata={onOverlayLoaded}
                onTimeUpdate={(e) => setOverlayCurrentTime(e.currentTarget.currentTime)}
                preload="auto"
                playsInline
                muted
                style={mediaStyle}
              />
              {overlayDuration > 0 && (
                <PlaybackBar
                  duration={overlayDuration}
                  currentTime={overlayCurrentTime}
                  onSeek={onOverlaySeek}
                />
              )}
            </>
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
