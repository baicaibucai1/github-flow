import { useEffect, useRef, type RefObject } from "react";
import { call, log, SESSION } from "./bridge";

/**
 * 曝光判定：可见面积 ≥50% 且连续停留 ≥1s 才记一次 impression。
 * 没到 1s 就划走的一律不记 —— 手册 §9.2：滑过头不等于看过。
 * (repo_id, session) 在 Rust 侧 UNIQUE，重复上报会被吞掉，所以这里只管本会话去重。
 */
const DWELL_MS = 1000;
/** 攒批上报的窗口与阈值：一屏 100 张卡逐条发就是 100 次 IPC，界面滑起来就卡。 */
const FLUSH_MS = 1200;
const FLUSH_AT = 20;

type Imp = { repoId: number; slot: number; channel: string };
const queue: Imp[] = [];
let flushTimer = 0;

function flushImpressions() {
  flushTimer = 0;
  if (!queue.length) return;
  const items = queue.splice(0, queue.length);
  call("log_impressions", { items, session: SESSION }).catch((e) => log("impression FAIL " + e));
}

function pushImpression(it: Imp) {
  queue.push(it);
  if (queue.length >= FLUSH_AT) {
    if (flushTimer) window.clearTimeout(flushTimer);
    flushImpressions();
    return;
  }
  if (!flushTimer) flushTimer = window.setTimeout(flushImpressions, FLUSH_MS);
}

// 关窗口前把队列倒出去，否则最后 1.2 秒的曝光会丢
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushImpressions);
  window.addEventListener("pagehide", flushImpressions);
}

type Handler = (visible: boolean) => void;

const handlers = new WeakMap<Element, Handler>();
let observer: IntersectionObserver | null = null;

function ensureObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === "undefined") return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) handlers.get(e.target)?.(e.isIntersecting);
    },
    { threshold: 0.5 }
  );
  return observer;
}

export function useExposure(meta: {
  id: number;
  slot: number;
  channel: string;
}): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = ensureObserver();
    if (!io) return;

    let timer = 0;
    let counted = false;

    handlers.set(el, (visible) => {
      if (visible) {
        if (counted || timer) return;
        timer = window.setTimeout(() => {
          timer = 0;
          counted = true;
          pushImpression({ repoId: meta.id, slot: meta.slot, channel: meta.channel });
        }, DWELL_MS);
      } else if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    });

    io.observe(el);
    return () => {
      handlers.delete(el);
      if (timer) window.clearTimeout(timer);
      io.unobserve(el);
    };
  }, [meta.id, meta.slot, meta.channel]);

  return ref;
}

export type EventKind =
  | "open"
  | "open_in_browser"
  | "star_in_app"
  | "copy_clone"
  | "dwell"
  | "hide"
  | "search";

export async function logEvent(
  kind: EventKind,
  repoId: number,
  payload?: string
): Promise<{ learned?: string[] }> {
  const r = await call<{ learned?: string[] }>("log_event", { kind, repoId, payload });
  log(`event ${kind} id=${repoId}`);
  return r;
}
