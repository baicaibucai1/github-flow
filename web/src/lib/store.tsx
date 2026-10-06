import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { call, log, type Counts, type Settings, type Stats } from "./bridge";

/**
 * 界面级共享状态：设置、主题、翻译、计数。
 * 取数逻辑一律在 Rust 侧，这里只持有渲染需要的快照。
 */
type Store = {
  ready: boolean;
  settings: Settings;
  setSetting: (key: string, value: string) => void;
  theme: "light" | "dark";
  dbg: boolean;
  setDbg: (v: boolean) => void;
  counts: Counts | null;
  refreshCounts: () => Promise<void>;
  stats: Stats | null;
  refreshStats: () => Promise<void>;
  /** 简介 → 译文；未翻出来时取不到值 */
  translated: Map<string, string>;
  requestTranslate: (texts: string[]) => void;
};

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore 必须在 AppProvider 内使用");
  return s;
}

const BATCH = 8; // 一次最多送 8 段去翻译，避免把第三方端点当数据库刷

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    theme: "light",
    set: "ink",
    lang: "zh-CN",
    translate_on: "0",
  });
  const [dbg, setDbg] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [translated, setTranslated] = useState<Map<string, string>>(new Map());

  const queue = useRef<Set<string>>(new Set());
  const timer = useRef<number | undefined>(undefined);
  const trOn = settings.translate_on === "1";

  useEffect(() => {
    call<Settings>("settings_json")
      .then((s) => setSettings((prev) => ({ ...prev, ...s })))
      .catch((e) => log("settings FAIL " + e));
    setReady(true);
  }, []);

  const resolvedTheme =
    settings.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.theme === "dark"
        ? "dark"
        : "light";

  useEffect(() => {
    applyTheme(settings, resolvedTheme);
    if (settings.theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme(settings, mq.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [settings, resolvedTheme]);

  const setSetting = useCallback((key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    call("set_setting_cmd", { key, value }).catch((e) => log(`set FAIL ${key} ${e}`));
  }, []);

  const flush = useCallback(async () => {
    const todo = [...queue.current].filter((t) => t.length > 3).slice(0, BATCH);
    queue.current.clear();
    if (!todo.length) return;
    try {
      const r = await call<{ map: Record<string, string>; net: number; cached: number }>(
        "do_translate",
        { texts: todo }
      );
      log(`translate net=${r.net} cached=${r.cached}`);
      setTranslated((prev) => {
        const next = new Map(prev);
        for (const [k, v] of Object.entries(r.map)) if (v && v !== k) next.set(k, v);
        return next;
      });
    } catch (e) {
      log("translate FAIL " + e);
    }
  }, []);

  const requestTranslate = useCallback(
    (texts: string[]) => {
      if (!trOn) return;
      let queued = false;
      for (const t of texts) {
        if (!t || t.length <= 3 || translated.has(t) || queue.current.has(t)) continue;
        queue.current.add(t);
        queued = true;
      }
      if (!queued) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 250);
    },
    [trOn, translated, flush]
  );

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await call<Counts>("get_counts"));
    } catch (e) {
      log("counts FAIL " + e);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await call<Stats>("get_stats"));
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    void refreshCounts();
    void refreshStats();
  }, [refreshCounts, refreshStats]);

  const value = useMemo<Store>(
    () => ({
      ready,
      settings,
      setSetting,
      theme: resolvedTheme,
      dbg,
      setDbg,
      counts,
      refreshCounts,
      stats,
      refreshStats,
      translated,
      requestTranslate,
    }),
    [
      ready,
      settings,
      setSetting,
      resolvedTheme,
      dbg,
      counts,
      refreshCounts,
      stats,
      refreshStats,
      translated,
      requestTranslate,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function applyTheme(s: Settings, theme: "light" | "dark") {
  const root = document.documentElement;
  root.dataset.set = s.set || "ink";
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}
