"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConversionPanel } from "@/components/ConversionPanel";
import { HistoryPanel, type LoadTaskPayload } from "@/components/HistoryPanel";
import { ProgressDisplay } from "@/components/ProgressDisplay";
import { ReviewPanel } from "@/components/ReviewPanel";
import { SystemStats } from "@/components/SystemStats";
import { TrackSelector } from "@/components/TrackSelector";
import { VideoUploader } from "@/components/VideoUploader";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import {
  TrackInfo,
  downloadBvhText,
  getStatus,
  getTracks,
  overlayUrl,
  postConvert,
  uploadVideo,
  videoUrl,
} from "@/services/apiClient";
import { bvhTextToVrmaBlob } from "@/services/bvhToVrma";

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clipInfo, setClipInfo] = useState<{ file?: File; url?: string; start: number; end: number } | null>(null);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[] | null>(null);
  const [detectionFps, setDetectionFps] = useState(30);
  const [totalFrames, setTotalFrames] = useState(0);
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const [convertedTrackId, setConvertedTrackId] = useState<number | null>(null);
  const [bvhText, setBvhText] = useState<string | null>(null);
  const [vrmaBlob, setVrmaBlob] = useState<Blob | null>(null);
  const [frameStep, setFrameStep] = useState(1);
  const [currentFrameStep, setCurrentFrameStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const progress = useTaskProgress(taskId);

  const srcVideoUrl = useMemo(() => (taskId ? videoUrl(taskId) : null), [taskId]);
  const effectiveStatus = progress.step ?? loadedStatus;
  const srcOverlayUrl = useMemo(
    () =>
      taskId &&
      effectiveStatus &&
      !["queued", "detecting", "rendering_overlay"].includes(effectiveStatus)
        ? overlayUrl(taskId)
        : null,
    [taskId, effectiveStatus],
  );

  const onFileSelected = useCallback((file: File) => {
    setSelectedFile(file);
    setClipInfo(null);
    setTaskId(null);
    setFileName(null);
    setShareToken(null);
    setTracks(null);
    setSelectedTrack(null); setConvertedTrackId(null);
    setBvhText(null);
    setVrmaBlob(null);
    setPageError(null);
    setLoadedStatus(null);
  }, []);

  const onStartConvert = useCallback(
    async (file: File, startTime: number, endTime: number, stepOverride?: number) => {
      const step = stepOverride ?? frameStep;
      setBusy(true);
      setPageError(null);
      setClipInfo({ file, start: startTime, end: endTime });
      setLoadedStatus(null);
      setTracks(null);
      setSelectedTrack(null); setConvertedTrackId(null);
      setBvhText(null);
      setVrmaBlob(null);
      try {
        const { task_id, share_token } = await uploadVideo(file, startTime, endTime, step);
        setTaskId(task_id);
        setFileName(file.name);
        setShareToken(share_token);
        setSelectedFile(null);
        setHistoryKey((k) => k + 1);
      } catch (err) {
        setPageError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [frameStep],
  );

  useEffect(() => {
    if (!taskId || progress.step !== "tracks_ready" || tracks !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getTracks(taskId);
        if (cancelled) return;
        setTracks(res.tracks);
        setDetectionFps(res.detection_fps);
        setTotalFrames(res.total_frames);
        setCurrentFrameStep(res.frame_step ?? 1);
        if (res.tracks.length > 0) setSelectedTrack(res.tracks[0].track_id);
      } catch (e) {
        if (!cancelled) setPageError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, progress.step, tracks]);

  useEffect(() => {
    if (!taskId || progress.step !== "bvh_ready" || vrmaBlob) return;
    let cancelled = false;
    (async () => {
      try {
        const bvh = await downloadBvhText(taskId);
        if (cancelled) return;
        setBvhText(bvh);
        const blob = await bvhTextToVrmaBlob(bvh, { scale: 0.01 });
        if (!cancelled) {
          setVrmaBlob(blob);
          // 剛轉換完成的 VRMA 對應的就是當前 selectedTrack
          if (selectedTrack != null) setConvertedTrackId(selectedTrack);
          setHistoryKey((k) => k + 1);
        }
      } catch (e) {
        if (!cancelled) setPageError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, progress.step, vrmaBlob, selectedTrack]);

  const onConvert = useCallback(
    async ({ fps, smoothing }: { fps: number; smoothing: boolean }) => {
      if (!taskId || selectedTrack == null) return;
      setBusy(true);
      setPageError(null);
      setBvhText(null);
      setVrmaBlob(null);
      try {
        await postConvert(taskId, { track_id: selectedTrack, fps, smoothing });
      } catch (e) {
        setPageError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [taskId, selectedTrack],
  );

  const onLoadTask = useCallback(
    async (payload: LoadTaskPayload) => {
      const loadTaskId = payload.taskId;
      const loadFileName = payload.fileName;
      if (loadTaskId === taskId) return;
      setSelectedFile(null);
      setClipInfo(null);
      setTaskId(loadTaskId);
      setFileName(loadFileName);
      setShareToken(payload.shareToken || null);
      setTracks(null);
      setSelectedTrack(null); setConvertedTrackId(null);
      setBvhText(null);
      setVrmaBlob(null);
      setPageError(null);
      setLoadedStatus(null);
      setBusy(true);
      try {
        const st = await getStatus(loadTaskId);
        setLoadedStatus(st.status);
        // 用後端 video URL 重建 clipInfo，讓 ReviewPanel 能進同步模式
        if (payload.clipEnd > payload.clipStart) {
          setClipInfo({
            url: videoUrl(loadTaskId),
            start: payload.clipStart,
            end: payload.clipEnd,
          });
        }
        if (st.status === "tracks_ready" || st.status === "bvh_ready") {
          const res = await getTracks(loadTaskId);
          setTracks(res.tracks);
          setDetectionFps(res.detection_fps);
          setTotalFrames(res.total_frames);
          setCurrentFrameStep(res.frame_step ?? 1);
          // 優先用原轉換的 track_id，否則 fallback 到第一個
          const preferredId = payload.convertedTrackId;
          const initialId =
            preferredId != null && res.tracks.some((t) => t.track_id === preferredId)
              ? preferredId
              : res.tracks[0]?.track_id ?? null;
          if (initialId != null) setSelectedTrack(initialId);
        }
        if (st.status === "bvh_ready") {
          const bvh = await downloadBvhText(loadTaskId);
          setBvhText(bvh);
          const blob = await bvhTextToVrmaBlob(bvh, { scale: 0.01 });
          setVrmaBlob(blob);
          if (payload.convertedTrackId != null) setConvertedTrackId(payload.convertedTrackId);
        }
      } catch (e) {
        setPageError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [taskId],
  );

  const onDownloadBvh = useCallback(() => {
    if (!bvhText) return;
    const blob = new Blob([bvhText], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stem = fileName ? fileName.replace(/\.[^.]+$/, "") : (taskId ?? "output");
    a.download = `${stem}.bvh`;
    a.click();
    URL.revokeObjectURL(url);
  }, [bvhText, fileName, taskId]);

  const onDownloadVrma = useCallback(() => {
    if (!vrmaBlob) return;
    const url = URL.createObjectURL(vrmaBlob);
    const a = document.createElement("a");
    a.href = url;
    const stem = fileName ? fileName.replace(/\.[^.]+$/, "") : (taskId ?? "output");
    a.download = `${stem}.vrma`;
    a.click();
    URL.revokeObjectURL(url);
  }, [vrmaBlob, fileName, taskId]);

  const onReset = useCallback(() => {
    setSelectedFile(null);
    setClipInfo(null);
    setTaskId(null);
    setFileName(null);
    setShareToken(null);
    setTracks(null);
    setSelectedTrack(null); setConvertedTrackId(null);
    setBvhText(null);
    setVrmaBlob(null);
    setPageError(null);
    setLoadedStatus(null);
  }, []);

  const onCopyShareLink = useCallback(() => {
    if (!shareToken) return;
    const link = `${window.location.origin}/r/${shareToken}`;
    navigator.clipboard.writeText(link).catch(() => {});
    alert(`link copied:\n${link}`);
  }, [shareToken]);

  const canConvert =
    taskId !== null &&
    selectedTrack !== null &&
    !busy &&
    (effectiveStatus === "tracks_ready" || effectiveStatus === "bvh_ready");

  const trimConfig = selectedFile
    ? { file: selectedFile, disabled: busy, onStart: onStartConvert }
    : null;

  // trackTiming 跟著 selectedTrack 走：使用者切 TrackSelector 時立即更新三面板
  // 同步視窗（video/overlay jump 到新 track 範圍）；若選中的 track 跟已轉換的
  // convertedTrackId 不同，VRM 視覺上會暫時對不上（提示使用者需要 re-convert）。
  const timingTrackInfo = tracks?.find((t) => t.track_id === selectedTrack);
  const trackTiming = timingTrackInfo
    ? {
        startFrame: timingTrackInfo.start_frame,
        totalFrames,
        detectionFps,
      }
    : null;

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>video2vrma</h1>
        <SystemStats />
      </div>
      <p style={{ color: "#666" }}>
        upload MP4 → trim → PHALP detect → select track → BVH → VRMA → VRM preview
      </p>

      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: "bold", fontSize: "0.95em" }}>
          history
        </summary>
        <HistoryPanel onLoadTask={onLoadTask} currentTaskId={taskId} refreshKey={historyKey} />
      </details>

      <section style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <VideoUploader disabled={busy || !!taskId} onFileSelected={onFileSelected} />
          {!taskId && (
            <label style={{ fontSize: "0.85em", color: "#666" }}>
              frame step:
              <select
                value={frameStep}
                onChange={(e) => setFrameStep(Number(e.target.value))}
                style={{ marginLeft: 4 }}
              >
                <option value={1}>1 (full)</option>
                <option value={3}>3 (fast)</option>
                <option value={5}>5 (faster)</option>
              </select>
            </label>
          )}
          {(selectedFile || taskId) && (
            <span style={{ fontSize: "0.85em", color: "#666" }}>
              {taskId && <>task: <code>{taskId}</code>{currentFrameStep > 1 && <> · step {currentFrameStep}</>} · </>}
              {fileName || selectedFile?.name}
              {shareToken && (
                <button onClick={onCopyShareLink} style={{ marginLeft: 8, fontSize: "0.85em" }}>
                  copy share link
                </button>
              )}
              <button onClick={onReset} style={{ marginLeft: 8, fontSize: "0.85em" }}>
                reset
              </button>
            </span>
          )}
        </div>
      </section>

      {taskId && (
        <section style={{ marginBottom: 16 }}>
          <ProgressDisplay
            step={progress.step}
            progress={progress.progress}
            message={progress.message}
            error={progress.error}
            fileName={fileName}
          />
        </section>
      )}

      {tracks && (
        <section style={{ marginBottom: 16 }}>
          <TrackSelector
            tracks={tracks}
            selected={selectedTrack}
            disabled={busy || progress.step === "converting"}
            onSelect={setSelectedTrack}
          />
        </section>
      )}

      {tracks && tracks.length > 0 && (
        <section style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <ConversionPanel disabled={!canConvert} defaultFps={Math.round(detectionFps / currentFrameStep)} onConvert={onConvert} />
          {vrmaBlob && convertedTrackId != null && selectedTrack !== convertedTrackId && (
            <span style={{ fontSize: "0.82em", color: "#c80", background: "#fff7e0", padding: "4px 10px", borderRadius: 4, border: "1px solid #e0b050" }}>
              ⚠ VRM 仍是 Track {convertedTrackId} 的內容，請重新轉換以套用 Track {selectedTrack}
            </span>
          )}
          {currentFrameStep > 1 && clipInfo?.file && (
            <button
              onClick={() => onStartConvert(clipInfo.file!, clipInfo.start, clipInfo.end, 1)}
              disabled={busy}
              style={{ padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: "0.85em" }}
            >
              re-detect (full frames)
            </button>
          )}
        </section>
      )}

      {pageError && (
        <pre style={{ color: "#c33", background: "#fee", padding: 12, overflow: "auto" }}>{pageError}</pre>
      )}

      {(bvhText || vrmaBlob) && (
        <section style={{ marginBottom: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {bvhText && (
            <button onClick={onDownloadBvh} style={dlBtnStyle}>
              download BVH ({Math.round(bvhText.length / 1024)} KB)
            </button>
          )}
          {vrmaBlob && (
            <button onClick={onDownloadVrma} style={dlBtnStyle}>
              download VRMA ({Math.round(vrmaBlob.size / 1024)} KB)
            </button>
          )}
        </section>
      )}

      <section style={{ marginBottom: 16 }}>
        <ReviewPanel
          videoUrl={srcVideoUrl}
          overlayUrl={srcOverlayUrl}
          vrmaBlob={vrmaBlob}
          vrmUrl="/models/default.vrm"
          trim={trimConfig}
          clip={clipInfo}
          trackTiming={trackTiming}
        />
      </section>

      <p style={{ marginTop: "0.5rem", color: "#666", fontSize: "0.85em" }}>
        drag to rotate VRM camera, scroll to zoom.
      </p>
    </main>
  );
}

const dlBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  background: "#3a6",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
};
