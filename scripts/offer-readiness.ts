import { promises as dns } from "node:dns";

const REQUEST_TIMEOUT_MS = 5000;

// Asks the zone's own nameservers, which never cache, so polling a tunnel that isn't
// registered yet can't leave a 30-minute "does not exist" entry in this machine's DNS cache.
export async function authoritativeResolves(hostname: string) {
  const zone = hostname.split(".").slice(-2).join(".");

  try {
    const nameServers = await dns.resolveNs(zone);
    const addresses = (
      await Promise.all(
        nameServers.slice(0, 2).map((nameServer) => dns.resolve4(nameServer).catch(() => [])),
      )
    ).flat();

    if (addresses.length === 0) {
      return null;
    }

    const resolver = new dns.Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(addresses);
    const records = await resolver.resolve4(hostname).catch(() => []);
    return records.length > 0;
  } catch {
    return null;
  }
}

export async function systemResolves(hostname: string) {
  try {
    await dns.lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

export async function preflightStatus(appUrl: string) {
  try {
    const response = await fetch(`${appUrl}/api/offers/decide`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://extensions.shopifycdn.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return null;
  }
}

export const FLUSH_DNS_FIX =
  "This machine cached the tunnel as missing before it existed. On macOS run `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`, or restart `shopify app dev` to get a new tunnel.";

export async function checkAppUrl(appUrl: string) {
  const hostname = new URL(appUrl).hostname;
  const registered = await authoritativeResolves(hostname);
  const resolves = await systemResolves(hostname);
  const status = resolves ? await preflightStatus(appUrl) : null;

  return { hostname, registered, resolves, status, ready: status === 204 };
}
