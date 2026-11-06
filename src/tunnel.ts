// Expose the local live-view server over HTTPS.
//   default: a Cloudflare quick tunnel (no account; random https://…trycloudflare.com)
//   AMAZON_SIGNIN_PUBLIC_URL: skip the tunnel — you already route that URL to AMAZON_SIGNIN_PORT
//   (e.g. a VPS behind your own domain, Cloudflare Access, or Tailscale).
import { spawn } from "node:child_process";

export interface Tunnel {
  url: string;
  close(): void;
}

/** True once public DNS answers for the host (asks two DoH frontends; either may hold a stale NXDOMAIN). */
async function resolvesPublicly(host: string): Promise<boolean> {
  const ask = async (resolver: string) => {
    try {
      const r = await fetch(`https://${resolver}/dns-query?name=${encodeURIComponent(host)}&type=A`, {
        headers: { accept: "application/dns-json" },
      });
      const j = (await r.json()) as { Status: number; Answer?: unknown[] };
      return j.Status === 0 && !!j.Answer?.length;
    } catch {
      return false;
    }
  };
  const [a, b] = await Promise.all([ask("1.1.1.1"), ask("1.0.0.1")]);
  return a || b;
}

export async function openTunnel(
  port: number,
  { timeoutMs = 30_000, publicUrl = process.env.AMAZON_SIGNIN_PUBLIC_URL }: { timeoutMs?: number; publicUrl?: string | null } = {},
): Promise<Tunnel> {
  const fixed = publicUrl;
  if (fixed) return { url: fixed.replace(/\/$/, ""), close() {} };

  const proc = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const close = () => {
    if (proc.exitCode === null) proc.kill("SIGTERM");
  };
  // Never leave a public tunnel behind: close it on normal exit and on Ctrl-C / kill.
  process.once("exit", close);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      close();
      process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 } as const)[sig]);
    });
  }

  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cloudflared did not report a tunnel URL in time")), timeoutMs);
      const scan = (buf: Buffer) => {
        const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      };
      proc.stdout.on("data", scan);
      proc.stderr.on("data", scan);
      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? new Error("cloudflared is not installed (brew install cloudflared), or set AMAZON_SIGNIN_PUBLIC_URL")
            : e,
        );
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`cloudflared exited (${code}) before the tunnel was ready`));
      });
    });

    // A new quick tunnel's hostname takes ~10 s to appear in DNS. Wait for it via Cloudflare's
    // DNS-over-HTTPS — probing through the local resolver too early caches NXDOMAIN on this machine.
    const host = new URL(url).hostname;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await resolvesPublicly(host)) {
        await Bun.sleep(2000); // edge routing settles just after the record appears
        return { url, close };
      }
      await Bun.sleep(1500);
    }
    throw new Error("The tunnel hostname never appeared in DNS");
  } catch (e) {
    close();
    throw e;
  }
}
