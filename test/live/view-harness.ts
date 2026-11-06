// Dev harness for the MCP App view: `bun run view`, then open http://127.0.0.1:4877/
//   ?tool=amazon_search&args={"query":"gel pens","maxPrice":15}   (any tool + JSON args)
//   &theme=dark
// Runs the real MCP server on a throwaway GUEST session, so buttons never touch your real cart.
// VIEW_SESSION_FILE=<copy of a session.json> previews a signed-in cart instead (buttons then act on it).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { VIEW_URI } from "../../src/view.ts";

const PORT = Number(process.env.VIEW_PORT ?? 4877);
const client = new Client({ name: "view-harness", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: "bun",
    args: [new URL("../../src/mcp.ts", import.meta.url).pathname],
    env: { ...process.env, AMAZON_SESSION_FILE: process.env.VIEW_SESSION_FILE ?? "/tmp/amazon-view-harness-session.json" } as Record<string, string>,
  }),
);

const built = await Bun.build({ entrypoints: [new URL("./view-host.ts", import.meta.url).pathname], target: "browser" });
if (!built.success) throw new AggregateError(built.logs, "host bundle failed");
const hostJs = await built.outputs[0]!.text();

const hostPage = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>View harness</title><style>body{margin:0;padding:16px;font:13px system-ui} iframe{width:100%;border:1px solid #ccc;border-radius:12px;height:600px;background:transparent}</style></head>
<body><iframe id="view" sandbox="allow-scripts allow-same-origin"></iframe><script type="module">${hostJs}</script></body></html>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response(hostPage, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/view") {
      const res = await client.readResource({ uri: VIEW_URI });
      return new Response((res.contents[0] as { text: string }).text, { headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/call" && req.method === "POST") {
      const { name, arguments: args } = (await req.json()) as { name: string; arguments: Record<string, unknown> };
      return Response.json(await client.callTool({ name, arguments: args }));
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`view harness on http://127.0.0.1:${server.port}/ (${process.env.VIEW_SESSION_FILE ? "session: " + process.env.VIEW_SESSION_FILE : "guest session"})`);
