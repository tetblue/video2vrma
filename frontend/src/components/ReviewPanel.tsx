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
  const [vrmaDuration, setVrmaDuration] = useState(0);
  const rafRef = useRef<number>(0);
  const prevSyncStartRef = useRef<number | null>(null);

  const onVrmReady = useCallback((d: number) => setVrmaDuration(d), []);

  // vrmaBlob 清空（例如 re-convert 過程中）時，vrmaDuration 也要重置，
  // 避免用上一個 VRMA 的 duration 計算 loop 範圍。
  useEffect(() => {
    if (!vrmaBlob) setVrmaDuration(0);
  }, [vrmaBlob]);

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

  // 同步播放時的 VRMA 有效視窗（以 video 絕對時間表示）：
  // [clipStart + trackOffsetTime, clipStart + trackOffsetTime + vrmaDuration]
  // 若 vrmaDuration 為 0（VRMA 未載入），退回 [clipStart, clipEnd]
  const syncVideoStart = clipStart + trackOffsetTime;
  const syncVideoEnd = vrmaDuration > 0
    ? Math.min(syncVideoStart + vrmaDuration, clipEnd || Infinity)
    : clipEnd;
  const syncOverlayStart = trackOffsetTime;
  const syncOverlayEnd = vrmaDuration > 0
    ? syncOverlayStart + vrmaDuration
    : (overlayDuration || syncOverlayStart);

  // 同步視窗變動時（換 track / 新 VRMA 載入 / 首次進同步模式）→ 一律對齊三面板到新視窗起點。
  // 只要 syncVideoStart 變了就跳；不要等到 currentTime 跑出範圍才動，否則同一範圍內切 track 會看起來沒反應。
  useEffect(() => {
    if (!isSyncWithClip) {
      prevSyncStartRef.current = null;
      return;
    }
    const prev = prevSyncStartRef.current;
    const windowChanged = prev !== syncVideoStart;
    prevSyncStartRef.current = syncVideoStart;
    const v = videoRef.current;
    if (!v) return;
    const outOfRange = v.currentTime < syncVideoStart || v.currentTime >= syncVideoEnd;
    if (!windowChanged && !outOfRange) return;
    v.currentTime = syncVideoStart;
    setCurrentTime(syncVideoStart);
    if (overlayRef.current) {
      overlayRef.current.currentTime = syncOverlayStart;
      setOverlayCurrentTime(syncOverlayStart);
    }
    vrmRef.current?.setTime(0);
  }, [isSyncWithClip, syncVideoStart, syncVideoEnd, syncOverlayStart]);

  const onVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration || 0;
    setDuration(dur);
    if (isTrimming) {
      setStartTime(0);
      setEndTime(dur);
      setCurrentTime(0);
    } else if (isSyncWithClip) {
      v.currentTime = syncVideoStart;
      setCurrentTime(syncVideoStart);
    } else if (isClipping) {
      v.currentTime = clipStart;
      setCurrentTime(clipStart);
    }
  }, [isTrimming, isClipping, isSyncWithClip, clipStart, syncVideoStart]);

  useEffect(() => {
    if (!isTrimming && !isClipping && !isSyncWithClip) return;
    const v = videoRef.current;
    if (!v) return;
    // 同步模式下 loop 縮到 VRMA 有效視窗；trim / clip-only 維持原本
    let loopStart: number;
    let loopEnd: number;
    if (isTrimming) {
      loopStart = startTime;
      loopEnd = endTime;
    } else if (isSyncWithClip) {
      loopStart = syncVideoStart;
      loopEnd = syncVideoEnd;
    } else {
      loopStart = clipStart;
      loopEnd = clipEnd;
    }
    const tick = () => {
      setCurrentTime(v.currentTime);
      if (playing && v.currentTime >= loopEnd) {
        v.currentTime = loopStart;
        // 同步模式下 overlay / VRM 也要回到視窗起點
        if (isSyncWithClip) {
          if (overlayRef.current) overlayRef.current.currentTime = syncOverlayStart;
          overlayRef.current?.play();
          vrmRef.current?.setTime(0);
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
  }, [isTrimming, isClipping, isSyncWithClip, playing, startTime, endTime, clipStart, clipEnd, syncVideoStart, syncVideoEnd, syncOverlayStart, trackOffsetTime]);

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
      // 三窗格同步 + loop VRMA 視窗（clipStart+trackOffset..+vrmaDuration）
      const v = videoRef.current;
      if (v) {
        if (v.currentTime < syncVideoStart || v.currentTime >= syncVideoEnd) {
          v.currentTime = syncVideoStart;
        }
        v.play();
      }
      const ov = overlayRef.current;
      if (ov) {
        if (ov.currentTime < syncOverlayStart || ov.currentTime >= syncOverlayEnd) {
          ov.currentTime = syncOverlayStart;
        }
        ov.play();
      }
      vrmRef.current?.play();
    } else {
      videoRef.current?.play();
      overlayRef.current?.play();
      vrmRef.current?.play();
    }
    setPlaying(true);
  }, [isTrimming, isClipping, isSyncWithClip, startTime, endTime, clipStart, clipEnd, syncVideoStart, syncVideoEnd, syncOverlayStart, syncOverlayEnd]);

  const syncPause = useCallback(() => {
    videoRef.current?.pause();
    if (!isTrimming && !isClipping) {
      overlayRef.current?.pause();
      vrmRef.current?.pause();
    }
    setPlaying(false);
  }, [isTrimming, isClipping, isSyncWithClip]);

  const syncReset = useCallback(() => {
    const videoResetTo = isTrimming
      ? startTime
      : isSyncWithClip
        ? syncVideoStart
        : isClipping
          ? clipStart
          : 0;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = videoResetTo;
    }
    if (!isTrimming && !isClipping) {
      if (overlayRef.current) {
        overlayRef.current.pause();
        overlayRef.current.currentTime = isSyncWithClip ? syncOverlayStart : 0;
      }
      vrmRef.current?.reset();
    }
    setPlaying(false);
  }, [isTrimming, isClipping, isSyncWithClip, startTime, clipStart, syncVideoStart, syncOverlayStart]);

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
      // 同步模式下 localT 是 VRMA 視窗相對秒數（0 ~ vrmaDuration），
      // 否則是 clip 相對秒數（0 ~ clipEnd-clipStart）
      const v = videoRef.current;
      if (!v) return;
      const videoBase = isSyncWithClip && vrmaDuration > 0 ? syncVideoStart : clipStart;
      const overlayBase = isSyncWithClip && vrmaDuration > 0 ? syncOverlayStart : 0;
      const absT = videoBase + localT;
      v.currentTime = absT;
      setCurrentTime(absT);
      const ov = overlayRef.current;
      if (ov) {
        const ovT = overlayBase + localT;
        ov.currentTime = ovT;
        setOverlayCurrentTime(ovT);
      }
      if (vrmaBlob) {
        vrmRef.current?.setTime(localT);
      }
    },
    [isSyncWithClip, vrmaDuration, syncVideoStart, syncOverlayStart, clipStart, vrmaBlob],
  );

  const onOverlaySeek = useCallback(
    (localT: number) => {
      // 同步模式下 localT 是 VRMA 視窗相對秒數（0 ~ vrmaDuration），
      // 否則是 overlay 絕對秒數
      const ov = overlayRef.current;
      if (!ov) return;
      const overlayBase = isSyncWithClip && vrmaDuration > 0 ? syncOverlayStart : 0;
      const videoBase = isSyncWithClip && vrmaDuration > 0 ? syncVideoStart : clipStart;
      const ovT = overlayBase + localT;
      ov.currentTime = ovT;
      setOverlayCurrentTime(ovT);
      const v = videoRef.current;
      if (v && clip) {
        const absT = videoBase + localT;
        v.currentTime = absT;
        setCurrentTime(absT);
      }
      if (vrmaBlob) {
        // 在同步窗內 localT 即是 vrmT；非同步模式退回原 offset 邏輯
        const vrmT = isSyncWithClip && vrmaDuration > 0 ? localT : localT - trackOffsetTime;
        vrmRef.current?.setTime(vrmT);
      }
    },
    [isSyncWithClip, vrmaDuration, syncOverlayStart, syncVideoStart, clip, clipStart, vrmaBlob, trackOffsetTime],
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
              {!isTrimming && clip && overlayUrl && (
                isSyncWithClip && vrmaDuration > 0 ? (
                  <PlaybackBar
                    duration={syncVideoEnd - syncVideoStart}
                    currentTime={Math.max(0, Math.min(currentTime - syncVideoStart, syncVideoEnd - syncVideoStart))}
                    onSeek={onVideoSeek}
                  />
                ) : clipEnd > clipStart ? (
                  <PlaybackBar
                    duration={clipEnd - clipStart}
                    currentTime={Math.max(0, currentTime - clipStart)}
                    onSeek={onVideoSeek}
                  />
                ) : null
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
                isSyncWithClip && vrmaDuration > 0 ? (
                  <PlaybackBar
                    duration={syncOverlayEnd - syncOverlayStart}
                    currentTime={Math.max(0, Math.min(overlayCurrentTime - syncOverlayStart, syncOverlayEnd - syncOverlayStart))}
                    onSeek={onOverlaySeek}
                  />
                ) : (
                  <PlaybackBar
                    duration={overlayDuration}
                    currentTime={overlayCurrentTime}
                    onSeek={onOverlaySeek}
                  />
                )
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
            onReady={onVrmReady}
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
