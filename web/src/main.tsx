import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { log } from "./lib/bridge";

// 界面里出的错必须先落到磁盘上那份 log，否则窗口一关什么都查不到
window.addEventListener("error", (e) =>
  log(`JSERR ${e.message} @${e.filename ?? "?"}:${e.lineno ?? "?"}`)
);
window.addEventListener("unhandledrejection", (e) => log("REJECT " + String(e.reason)));

// 不开 StrictMode：曝光与 dwell 计时靠副作用上报，双调用会把同一行为记两遍
createRoot(document.getElementById("root")!).render(<App />);
