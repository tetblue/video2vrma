"use client";

import { useEffect, useState } from "react";

import { TaskStep, wsUrl } from "@/services/apiClient";

export type TaskProgress = {
  step: TaskStep | null;
  progress: number;
  message: string;
  error: string | null;
  connected: boolean;
};

const INITIAL: TaskProgress = {
  step: null,
  progress: 0,
  message: "",
  error: null,
  connected: false,
};

export function useTaskProgress(taskId: string | null): TaskProgress {
  const [state, setState] = useState<TaskProgress>(INITIAL);

  useEffect(() => {
    if (!taskId) {
      setState(INITIAL);
      return;
    }

    const ws = new WebSocket(wsUrl(taskId));
    let cancelled = false;

    ws.onopen = () => {
      if (!cancelled) setState((s) => ({ ...s, connected: true, error: null }));
    };
    ws.onerror = () => {
      if (!cancelled) setState((s) => ({ ...s, error: "WebSocket 連線錯誤" }));
    };
    ws.onclose = () => {
      if (!cancelled) setState((s) => ({ ...s, connected: false }));
    };
    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "snapshot" || msg.type === "progress") {
          setState((s) => ({
            ...s,
            step: (msg.step ?? msg.status) as TaskStep,
            progress: typeof msg.progress === "number" ? msg.progress : s.progress,
            message: typeof msg.message === "string" ? msg.message : s.message,
            error: msg.error ?? null,
          }));
        }
      } catch (e) {
        console.error("ws parse failed", e, ev.data);
      }
    };

    return () => {
      cancelled = true;
      ws.close();
    };
  }, [taskId]);

  return state;
}
