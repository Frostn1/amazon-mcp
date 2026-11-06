/// <reference lib="dom" />
// Browser side of the view harness: a minimal MCP Apps host built from the SDK's own AppBridge.
// It embeds the shop view, pushes a real tool result into it, and proxies the view's tool calls
// to the harness server (which forwards them to the real MCP server).
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

type Log = { t: string; detail: unknown };
const log: Log[] = ((window as any).__log = []);
const note = (t: string, detail?: unknown) => log.push({ t, detail });

const qs = new URLSearchParams(location.search);
const tool = qs.get("tool") ?? "amazon_search";
const args = JSON.parse(qs.get("args") ?? '{"query":"gel pens","maxPrice":15,"images":0}');
const theme = (qs.get("theme") ?? "light") as "light" | "dark";
document.documentElement.style.colorScheme = theme;
document.body.style.background = theme === "dark" ? "#262624" : "#f5f4ef";

async function call(name: string, a: unknown) {
  const res = await fetch("/call", { method: "POST", body: JSON.stringify({ name, arguments: a }) });
  return res.json();
}

// Listen before the view loads: it sends ui/initialize as soon as it starts.
const iframe = document.getElementById("view") as HTMLIFrameElement;
const bridge = new AppBridge(null, { name: "harness", version: "0" }, { openLinks: {}, serverTools: {}, logging: {} });
bridge.oncalltool = async (p) => (note("calltool", p), call(p.name, p.arguments ?? {}));
bridge.onopenlink = async (p) => (note("openlink", p), {});
bridge.onupdatemodelcontext = async (p) => (note("modelcontext", p), {});
bridge.onsizechange = (p) => {
  if (p.height) iframe.style.height = `${p.height}px`;
};
bridge.oninitialized = async () => {
  note("initialized");
  bridge.setHostContext({ theme });
  await bridge.sendToolInput({ arguments: args });
  const result = await call(tool, args);
  note("result-meta-keys", Object.keys(result._meta ?? {}));
  await bridge.sendToolResult(result);
  note("sent-result");
};
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
iframe.src = "/view";
