"use client";

import { useCallback, useEffect, useState } from "react";

import { ConversionPanel } from "@/components/ConversionPanel";
import { ProgressDisplay } from "@/components/ProgressDisplay";
import { TrackSelector } from "@/components/TrackSelector";
import { VideoUploader } from "@/components/VideoUploader";
import { VrmPreview } from "@/components/VrmPreview";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import {
  TrackInfo,
  downloadBvhText,
  getTracks,
  postConvert,
} from "@/services/apiClient";
import { bvhTextToVrmaBlob } from "@/services/bvhToVrma";

export default function Home() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[] | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const [vrmaBlob, setVrmaBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const progress = useTaskProgress(taskId);

  const onUploaded = useCallback((id: string, name: string) => {
    setTaskId(id);
    setFileName(name);
    setTracks(null);
    setSelectedTrack(null);
    setVrmaBlob(null);
    setPageError(null);
  }, []);

  // tracks_ready 後抓 track 列表
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

  // bvh_ready 後下載 BVH 並轉 VRMA 給預覽用
  useEffect(() => {
    if (!taskId || progress.step !== "bvh_ready" || vrmaBlob) return;
    let cancelled = false;
    (async () => {
      try {
        const bvh = await downloadBvhText(taskId);
        if (cancelled) return;
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

  const onDownloadVrma = useCallback(() => {
    if (!vrmaBlob) return;
    const url = URL.createObjectURL(vrmaBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${taskId ?? "output"}.vrma`;
    a.click();
    URL.revokeObjectURL(url);
  }, [vrmaBlob, taskId]);

  const onReset = useCallback(() => {
    setTaskId(null);
    setFileName(null);
    setTracks(null);
    setSelectedTrack(null);
    setVrmaBlob(null);
    setPageError(null);
  }, []);

  const canConvert =
    taskId !== null &&
    selectedTrack !== null &&
    !busy &&
    (progress.step === "tracks_ready" || progress.step === "bvh_ready");

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 1080, margin: "0 auto" }}>
      <h1>video2vrma</h1>
      <p style={{ color: "#666" }}>
        上傳 MP4 影片 → PHALP 偵測人物 → 選 track → 轉 BVH → 瀏覽器內轉 VRMA → 套到 VRM 預覽
      </p>

      <section style={{ marginBottom: 16 }}>
        <VideoUploader disabled={busy || (taskId !== null && progress.step !== "bvh_ready" && progress.step !== "error")} onUploaded={onUploaded} />
        {taskId && (
          <div style={{ marginTop: 6, fontSize: "0.85em", color: "#666" }}>
            task: <code>{taskId}</code>
            {fileName && <> · {fileName}</>}
            <button onClick={onReset} style={{ marginLeft: 12, fontSize: "0.85em" }}>
              重新開始
            </button>
          </div>
        )}
      </section>

      {taskId && (
        <section style={{ marginBottom: 16 }}>
          <ProgressDisplay
            step={progress.step}
            progress={progress.progress}
            message={progress.message}
            error={progress.error}
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

      {vrmaBlob && (
        <section style={{ marginBottom: 8 }}>
          <button onClick={onDownloadVrma}>
            下載 VRMA ({Math.round(vrmaBlob.size / 1024)} KB)
          </button>
        </section>
      )}

      <section style={{ border: "1px solid #444", borderRadius: 4, overflow: "hidden" }}>
        <VrmPreview vrmUrl="/models/default.vrm" vrmaBlob={vrmaBlob} />
      </section>

      <p style={{ marginTop: "1rem", color: "#666", fontSize: "0.85em" }}>
        滑鼠拖曳可旋轉相機、滾輪縮放。後端 API base：{" "}
        <code>{process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"}</code>
      </p>
    </main>
  );
}
