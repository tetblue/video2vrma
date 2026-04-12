"use client";

import { useEffect, useState } from "react";

import { SystemStats as Stats, getSystemStats } from "@/services/apiClient";

const POLL_MS = 3000;

export function SystemStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getSystemStats();
        if (!cancelled) {
          setStats(s);
          setErr(false);
        }
      } catch {
        if (!cancelled) setErr(true);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (err) {
    return (
      <div style={containerStyle}>
        <span style={{ color: "#c33", fontSize: "0.8em" }}>backend 離線</span>
      </div>
    );
  }
  if (!stats) {
    return (
      <div style={containerStyle}>
        <span style={{ color: "#888", fontSize: "0.8em" }}>載入中…</span>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <Chip label="CPU" value={`${stats.cpu_pct.toFixed(0)}%`} color={barColor(stats.cpu_pct)} />
      {stats.gpu_util_pct != null && (
        <Chip
          label="GPU"
          value={`${stats.gpu_util_pct}%`}
          title={stats.gpu_name ?? undefined}
          color={barColor(stats.gpu_util_pct)}
        />
      )}
      {stats.gpu_mem_used_mb != null && stats.gpu_mem_total_mb != null && (
        <Chip
          label="VRAM"
          value={`${(stats.gpu_mem_used_mb / 1024).toFixed(1)} / ${(stats.gpu_mem_total_mb / 1024).toFixed(1)} GB`}
          color={barColor((stats.gpu_mem_used_mb / stats.gpu_mem_total_mb) * 100)}
        />
      )}
      <Chip
        label="佇列"
        value={`${stats.tasks_queued} 待處理`}
        color={stats.tasks_queued > 0 ? "#e8a" : "#8c8"}
      />
      {stats.tasks_active > 0 && (
        <Chip label="進行中" value={String(stats.tasks_active)} color="#8ae" />
      )}
    </div>
  );
}

function barColor(pct: number): string {
  if (pct > 80) return "#e66";
  if (pct > 50) return "#ea8";
  return "#8c8";
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

function Chip({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 12,
        background: color + "33",
        border: `1px solid ${color}`,
        fontSize: "0.8em",
        whiteSpace: "nowrap",
      }}
    >
      <strong>{label}</strong> {value}
    </span>
  );
}
