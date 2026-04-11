"use client";

import { useCallback, useState } from "react";

import { VrmPreview } from "@/components/VrmPreview";
import { bvhTextToVrmaBlob } from "@/services/bvhToVrma";

export default function Home() {
  const [vrmaBlob, setVrmaBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const blob = await bvhTextToVrmaBlob(text, { scale: 0.01 });
      setVrmaBlob(blob);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDownload = useCallback(() => {
    if (!vrmaBlob) return;
    const url = URL.createObjectURL(vrmaBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.vrma";
    a.click();
    URL.revokeObjectURL(url);
  }, [vrmaBlob]);

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 1080, margin: "0 auto" }}>
      <h1>video2vrma — Phase 2 驗證頁</h1>
      <p>選擇 Phase 1 產生的 BVH（例如 <code>tmp/phase1/dance.bvh</code>）自動轉成 VRMA 並疊到 VRM 上播放。</p>

      <section style={{ marginBottom: "1rem" }}>
        <label>
          <strong>選擇 BVH：</strong>
          <input type="file" accept=".bvh" onChange={onFile} disabled={busy} style={{ marginLeft: 8 }} />
        </label>
        {busy && <span style={{ marginLeft: 12 }}>轉換中...</span>}
        {vrmaBlob && (
          <button onClick={onDownload} style={{ marginLeft: 12 }}>
            下載 VRMA ({Math.round(vrmaBlob.size / 1024)} KB)
          </button>
        )}
      </section>

      {error && (
        <pre style={{ color: "#c33", background: "#fee", padding: 12, overflow: "auto" }}>{error}</pre>
      )}

      <section style={{ border: "1px solid #444", borderRadius: 4, overflow: "hidden" }}>
        <VrmPreview vrmUrl="/models/default.vrm" vrmaBlob={vrmaBlob} />
      </section>

      <p style={{ marginTop: "1rem", color: "#666", fontSize: "0.9em" }}>
        滑鼠拖曳可旋轉相機、滾輪縮放。若動畫不正常請看 console。
      </p>
    </main>
  );
}
