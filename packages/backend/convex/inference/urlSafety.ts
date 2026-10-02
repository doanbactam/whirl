// Guards the URLs we fetch server-side on a user's behalf — the MCP endpoint
// they enter plus the OAuth endpoints a server advertises during discovery.
// Two jobs:
//   1. require https, so decrypted headers / bearer tokens are never sent in
//      cleartext (the UI asks for https:// but the model never enforced it);
//   2. refuse hosts that are obviously internal (loopback, private/link-local
//      IP literals, `.local`/`.internal` names) to blunt SSRF.
// Convex's runtime has no DNS resolver, so this is literal-inspection only: it
// can't catch a public name that resolves to a private IP, but it does stop the
// direct `http://169.254.169.254` / `https://10.0.0.1` style of attack.

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  // Malformed octet → treat as unsafe rather than letting it through.
  if (octets.some((n) => n > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, incl. cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT (100.64.0.0/10)
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  // Link-local (fe80::/10) and unique-local (fc00::/7).
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4-mapped (e.g. ::ffff:10.0.0.1) — defer to the v4 check.
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/**
 * Validate a URL we're about to fetch server-side, returning the parsed `URL`.
 * Throws a user-facing error if it isn't an https URL pointing at a public host.
 */
export function assertSafeFetchUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Enter a full https:// URL for the server.");
  }
  const host = url.hostname.toLowerCase();
  const blockedName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal");
  if (blockedName || isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error("That host isn't allowed.");
  }
  return url;
}
