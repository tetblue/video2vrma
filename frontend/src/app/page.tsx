"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConversionPanel } from "@/components/ConversionPanel";
import { ProgressDisplay } from "@/components/ProgressDisplay";
import { ReviewPanel } from "@/components/ReviewPanel";
import { SystemStats } from "@/components/SystemStats";
import { TrackSelector } from "@/components/TrackSelector";
import { VideoUploader } from "@/components/VideoUploader";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import {
  TrackInfo,
  downloadBvhText,
  getTracks,
  overlayUrl,
  postConvert,
  uploadVideo,
  videoUrl,
} from "@/services/apiClient";
import { bvhTextToVrmaBlob } from "@/services/bvhToVrma";

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clipInfo, setClipInfo] = useState<{ file: File; start: number; end: number } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[] | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const [bvhText, setBvhText] = useState<string | null>(null);
  const [vrmaBlob, setVrmaBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const progress = useTaskProgress(taskId);

  const srcVideoUrl = useMemo(() => (taskId ? videoUrl(taskId) : null), [taskId]);
  const srcOverlayUrl = useMemo(
    () =>
      taskId &&
      progress.step &&
      !["queued", "detecting", "rendering_overlay"].includes(progress.step)
        ? overlayUrl(taskId)
        : null,
    [taskId, progress.step],
  );

  const onFileSelected = useCallback((file: File) => {
    setSelectedFile(file);
    setClipInfo(null);
    setTaskId(null);
    setFileName(null);
    setTracks(null);
    setSelectedTrack(null);
    setBvhText(null);
    setVrmaBlob(null);
    setPageError(null);
  }, []);

  const onStartConvert = useCallback(
    async (file: File, startTime: number, endTime: number) => {
      setBusy(true);
      setPageError(null);
      setClipInfo({ file, start: startTime, end: endTime });
      try {
        const { task_id } = await uploadVideo(file, startTime, endTime);
        setTaskId(task_id);
        setFileName(file.name);
        setSelectedFile(null);
      } catch (err) {
        setPageError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!taskId || progress.step !== "tracks_ready" || tracks !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getTracks(taskId);
        if (cancelled) return;
        setTracks(res.tracks);
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
        if (!cancelled) setVrmaBlob(blob);
      } catch (e) {
        if (!cancelled) setPageError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, progress.step, vrmaBlob]);

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
    setTracks(null);
    setSelectedTrack(null);
    setBvhText(null);
    setVrmaBlob(null);
    setPageError(null);
  }, []);

  const canConvert =
    taskId !== null &&
    selectedTrack !== null &&
    !busy &&
    (progress.step === "tracks_ready" || progress.step === "bvh_ready");

  const trimConfig = selectedFile
    ? { file: selectedFile, disabled: busy, onStart: onStartConvert }
    : null;

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>video2vrma</h1>
        <SystemStats />
      </div>
      <p style={{ color: "#666" }}>
        上傳 MP4 影片 → 設定轉換時間段 → PHALP 偵測人物 → 選 track → 轉 BVH → 瀏覽器內轉 VRMA → 套到 VRM 預覽
      </p>

      <section style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <VideoUploader disabled={busy || !!taskId} onFileSelected={onFileSelected} />
          {(selectedFile || taskId) && (
            <span style={{ fontSize: "0.85em", color: "#666" }}>
              {taskId && <>task: <code>{taskId}</code> · </>}
              {fileName || selectedFile?.name}
              <button onClick={onReset} style={{ marginLeft: 12, fontSize: "0.85em" }}>
                重新開始
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
        <section style={{ marginBottom: 16 }}>
          <ConversionPanel disabled={!canConvert} onConvert={onConvert} />
        </section>
      )}

      {pageError && (
        <pre style={{ color: "#c33", background: "#fee", padding: 12, overflow: "auto" }}>{pageError}</pre>
      )}

      {(bvhText || vrmaBlob) && (
        <section style={{ marginBottom: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {bvhText && (
            <button onClick={onDownloadBvh} style={dlBtnStyle}>
              下載 BVH ({Math.round(bvhText.length / 1024)} KB)
            </button>
          )}
          {vrmaBlob && (
            <button onClick={onDownloadVrma} style={dlBtnStyle}>
              下載 VRMA ({Math.round(vrmaBlob.size / 1024)} KB)
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
        />
      </section>

      <p style={{ marginTop: "0.5rem", color: "#666", fontSize: "0.85em" }}>
        滑鼠拖曳可旋轉 VRM 相機、滾輪縮放。
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
