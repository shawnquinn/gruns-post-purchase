import type { Plugin, ViteDevServer } from "vite";
import { FLUSH_DNS_FIX, authoritativeResolves, checkAppUrl } from "./offer-readiness";

const POLL_MS = 3000;
const REGISTER_TIMEOUT_MS = 120_000;
const MONITOR_MS = 30_000;

const log = (message: string) => console.log(`[offers] ${message}`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRegistration(hostname: string) {
  const deadline = Date.now() + REGISTER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const registered = await authoritativeResolves(hostname);

    if (registered !== false) {
      return true;
    }

    await wait(POLL_MS);
  }

  return false;
}

async function publishUntilDone(server: ViteDevServer, isStopped: () => boolean) {
  let warned = false;

  while (!isStopped()) {
    const { publishAppUrl } = (await server.ssrLoadModule(
      "/app/offers/publish-app-url.server.ts",
    )) as { publishAppUrl: () => Promise<boolean> };

    if (await publishAppUrl()) {
      return;
    }

    if (!warned) {
      log("Could not save the app URL yet. Press p to install or open the app, and this retries.");
      warned = true;
    }

    await wait(POLL_MS * 3);
  }
}

async function watchOffers(server: ViteDevServer, appUrl: string, isStopped: () => boolean) {
  const hostname = new URL(appUrl).hostname;
  log(`Waiting for ${hostname} to go live. Don't open the preview or check out yet.`);

  if (!(await waitForRegistration(hostname))) {
    log("The tunnel never appeared in DNS. Restart `shopify app dev`.");
    return;
  }

  await publishUntilDone(server, isStopped);

  let ready: boolean | null = null;

  while (!isStopped()) {
    const result = await checkAppUrl(appUrl);

    if (result.ready !== ready) {
      if (result.ready) {
        log(`Ready. Storefront checkouts will show the offer through ${appUrl}`);
      } else if (!result.resolves) {
        log(`Not ready: this machine can't resolve ${hostname}. ${FLUSH_DNS_FIX}`);
      } else {
        log(`Not ready: the tunnel isn't reaching the app (status ${result.status ?? "no response"}). Quick tunnels drop briefly and usually recover within a few seconds. Restart \`shopify app dev\` if this line isn't followed by Ready within a minute.`);
      }

      ready = result.ready;
    }

    await wait(ready ? MONITOR_MS : POLL_MS * 3);
  }
}

export function offerReadiness(): Plugin {
  return {
    name: "offer-readiness",
    apply: "serve",
    configureServer(server) {
      const appUrl = process.env.SHOPIFY_APP_URL;

      if (!appUrl?.startsWith("https://") || !server.httpServer) {
        return;
      }

      let stopped = false;
      server.httpServer.once("close", () => {
        stopped = true;
      });
      server.httpServer.once("listening", () => {
        watchOffers(server, appUrl, () => stopped).catch((error: unknown) => {
          log(`Readiness check stopped: ${error instanceof Error ? error.message : "unknown error"}`);
        });
      });
    },
  };
}
