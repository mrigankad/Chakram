import { useRef, useEffect, useCallback } from "react";
import { useAiIde, type FailedFile } from "@/context/AiIdeContext";

/** `failed_files` from GENERATION_DONE as typed state; anything malformed is dropped. */
export function parseFailedFiles(value: unknown): FailedFile[] {
  if (!Array.isArray(value)) return [];
  const out: FailedFile[] = [];
  for (const item of value) {
    const path = (item as { path?: unknown })?.path;
    if (typeof path !== "string" || !path || out.some((f) => f.path === path)) continue;
    const message = (item as { message?: unknown })?.message;
    out.push({ path, message: typeof message === "string" && message ? message : "No reason was reported." });
  }
  return out;
}

function getWsBase(): string {
  const viteWs = (import.meta as any).env?.VITE_WS_URL as string | undefined;
  if (viteWs) return viteWs;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api`;
}

const RECONNECT_DELAY_MS = 1500;

/**
 * Streams a generation run into the IDE state.
 *
 * The run is a server-side task, so this socket is only a view of it:
 * `startGeneration` sends the idea, `attachToRun` joins whatever run the
 * workspace already has (after a reload), and a dropped connection mid-run
 * re-attaches once before reporting the loss.
 */
export function useAiGenerationWS(workspaceId: string | null) {
  const { dispatch } = useAiIde();
  const wsRef = useRef<WebSocket | null>(null);
  const finishedRef = useRef(false);
  const reconnectedRef = useRef(false);

  // Token batching: flush every 50 ms to prevent React re-render storms
  const bufferRef = useRef<Record<string, string>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBuffer = useCallback(() => {
    const buf = bufferRef.current;
    for (const [path, tokens] of Object.entries(buf)) {
      if (tokens) dispatch({ type: "APPEND_TOKEN", path, token: tokens });
    }
    bufferRef.current = {};
    timerRef.current = null;
  }, [dispatch]);

  const flushNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      flushBuffer();
    }
  }, [flushBuffer]);

  const open = useCallback(
    (firstMessage: string, mode: "start" | "attach" | "reattach") => {
      if (!workspaceId) return;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      finishedRef.current = false;

      const url = `${getWsBase()}/ai-ide/ws/generate/${workspaceId}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      let sawEvent = false;

      if (mode === "start") {
        dispatch({ type: "SET_STATUS", status: "planning", message: "Connecting…" });
      }

      ws.onopen = () => {
        ws.send(firstMessage);
        if (mode === "start") {
          dispatch({ type: "SET_STATUS", status: "planning", message: "Planning your app…" });
        }
      };

      ws.onmessage = (ev) => {
        let data: Record<string, any>;
        try {
          data = JSON.parse(ev.data as string);
        } catch {
          return;
        }

        switch (data.type) {
          case "NO_RUN":
            // Nothing to attach to: the workspace is simply at rest.
            finishedRef.current = true;
            if (mode === "reattach") {
              dispatch({
                type: "SET_STATUS",
                status: "error",
                message: "The connection to the generator was lost and the run is no longer on the server.",
              });
            }
            ws.close();
            break;

          case "STATUS":
            sawEvent = true;
            dispatch({ type: "SET_STATUS", status: "generating", message: data.message });
            dispatch({ type: "ADD_LOG", message: data.message });
            break;

          case "PLAN": {
            sawEvent = true;
            const files = Array.isArray(data.files) ? data.files.filter((p: unknown) => typeof p === "string") : [];
            dispatch({
              type: "SET_PLAN",
              files,
              appName: typeof data.app_name === "string" ? data.app_name : "",
              description: typeof data.description === "string" ? data.description : "",
            });
            dispatch({ type: "SET_STATUS", status: "generating", message: `Plan ready: ${files.length} files` });
            dispatch({ type: "ADD_LOG", message: `Plan: ${files.join(", ")}` });
            break;
          }

          case "FILE_CREATE":
            sawEvent = true;
            dispatch({ type: "START_FILE_STREAM", path: data.path });
            dispatch({ type: "ADD_LOG", message: `Creating ${data.path}…` });
            break;

          case "STREAM_TOKEN": {
            // Buffer tokens and flush every 50 ms
            const buf = bufferRef.current;
            buf[data.path] = (buf[data.path] ?? "") + data.token;
            if (!timerRef.current) {
              timerRef.current = setTimeout(flushBuffer, 50);
            }
            break;
          }

          case "FILE_UPDATE":
            flushNow();
            dispatch({ type: "UPDATE_FILE", path: data.path, content: data.content, origin: "server" });
            dispatch({ type: "ADD_LOG", message: `Updated ${data.path}` });
            break;

          case "FILE_RENAMED": {
            // The server saved the streamed file under another name (JSX in a .ts file -> .tsx).
            flushNow();
            const from = String(data.from ?? "");
            const to = String(data.to ?? "");
            if (from && to) {
              dispatch({ type: "RENAME_PATH", fromPath: from, toPath: to });
              dispatch({ type: "UPDATE_FILE", path: to, content: String(data.content ?? ""), origin: "server" });
              dispatch({ type: "FILE_STREAM_DONE", path: from });
              dispatch({ type: "ADD_LOG", message: `Saved ${from} as ${to} (it contains JSX)` });
            }
            break;
          }

          case "FILE_DONE":
            // Tokens for this file may still be buffered; the file is only complete once they are in.
            flushNow();
            dispatch({ type: "FILE_STREAM_DONE", path: data.path });
            dispatch({ type: "ADD_LOG", message: `✓ ${data.path}` });
            break;

          case "FILE_ERROR":
            // The server wrote nothing for this file; drop the partial tokens shown while streaming.
            flushNow();
            dispatch({ type: "DELETE_PATH", path: data.path });
            dispatch({
              type: "ADD_FAILED_FILE",
              file: { path: String(data.path), message: typeof data.message === "string" && data.message ? data.message : "No reason was reported." },
            });
            dispatch({ type: "ADD_LOG", message: `Failed: ${data.path} (${data.message})` });
            break;

          case "GENERATION_DONE":
            flushNow();
            finishedRef.current = true;
            // The server's list is the record of what is missing; it replaces
            // whatever was collected from FILE_ERROR events while streaming.
            if (Array.isArray(data.failed_files)) {
              dispatch({ type: "SET_FAILED_FILES", files: parseFailedFiles(data.failed_files) });
            }
            if (data.files_failed > 0) {
              const summary = `${data.files_generated} of ${data.files_total} files generated; ${data.files_failed} failed`;
              dispatch({ type: "SET_STATUS", status: "error", message: summary });
              dispatch({ type: "ADD_LOG", message: summary });
            } else {
              dispatch({ type: "SET_STATUS", status: "done", message: "Generation complete" });
              dispatch({ type: "ADD_LOG", message: "✓ All files generated" });
            }
            if (Array.isArray(data.warnings)) {
              for (const warning of data.warnings) {
                if (warning && typeof warning.path === "string" && Array.isArray(warning.problems)) {
                  dispatch({ type: "ADD_LOG", message: `Check ${warning.path}: ${warning.problems.join("; ")}` });
                }
              }
            }
            if (data.usage && typeof data.usage.prompt_tokens === "number") {
              const u = data.usage;
              dispatch({
                type: "ADD_LOG",
                message: `Model usage: ${u.calls} call(s), ${u.prompt_tokens} prompt + ${u.completion_tokens} completion tokens`,
              });
            }
            ws.close();
            break;

          case "ERROR":
            finishedRef.current = true;
            dispatch({ type: "SET_STATUS", status: "error", message: data.message });
            dispatch({ type: "ADD_LOG", message: `Error: ${data.message}` });
            break;
        }
      };

      ws.onerror = () => {
        /* onclose follows and decides what to do */
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (finishedRef.current) return;
        // The run is still going on the server; pick it up again once.
        if (mode !== "reattach" && !reconnectedRef.current && (sawEvent || mode === "start")) {
          reconnectedRef.current = true;
          dispatch({ type: "ADD_LOG", message: "Connection lost; reconnecting to the run…" });
          setTimeout(() => open(JSON.stringify({ attach: true }), "reattach"), RECONNECT_DELAY_MS);
          return;
        }
        if (mode === "attach" && !sawEvent) return;
        dispatch({
          type: "SET_STATUS",
          status: "error",
          message: "The connection to the generator was lost. Check that the backend is running and try again.",
        });
      };
    },
    [workspaceId, dispatch, flushBuffer, flushNow],
  );

  const startGeneration = useCallback(
    (idea: string) => {
      reconnectedRef.current = false;
      open(idea, "start");
    },
    [open],
  );

  /** Join the run the workspace already has, if any; nothing changes when there is none. */
  const attachToRun = useCallback(() => {
    reconnectedRef.current = false;
    open(JSON.stringify({ attach: true }), "attach");
  }, [open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { startGeneration, attachToRun };
}
