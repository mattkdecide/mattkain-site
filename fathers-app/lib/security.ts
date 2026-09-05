type AccessEnv = {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  OWNER_EMAILS?: string;
};

type AccessClaims = {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iss?: string;
  sub?: string;
};
type AccessJwk = JsonWebKey & { kid?: string };

export type Owner = { id: string; email: string };

const encoder = new TextEncoder();
let cachedKeys: { expiresAt: number; keys: AccessJwk[] } | null = null;

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function setting(env: AccessEnv, name: keyof AccessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function accessKeys(teamDomain: string): Promise<AccessJwk[]> {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Unable to load Cloudflare Access signing keys");
  const body = await response.json() as { keys?: AccessJwk[] };
  if (!body.keys?.length) throw new Error("Cloudflare Access returned no signing keys");
  cachedKeys = { keys: body.keys, expiresAt: Date.now() + 5 * 60 * 1000 };
  return body.keys;
}

export async function verifyAccessOwner(request: Request, env: AccessEnv): Promise<Owner | null> {
  try {
    const cookieToken = request.headers.get("cookie")?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
    const token = request.headers.get("cf-access-jwt-assertion") ?? cookieToken ?? null;
    if (!token) return null;
    const [encodedHeader, encodedClaims, encodedSignature, extra] = token.split(".");
    if (!encodedHeader || !encodedClaims || !encodedSignature || extra) return null;
    const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
    if (header.alg !== "RS256" || !header.kid) return null;

    const teamDomain = setting(env, "CF_ACCESS_TEAM_DOMAIN").replace(/\/$/, "");
    const audience = setting(env, "CF_ACCESS_AUD");
    const key = (await accessKeys(teamDomain)).find((candidate) => candidate.kid === header.kid);
    if (!key) return null;
    const cryptoKey = await crypto.subtle.importKey(
      "jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", cryptoKey, decodeBase64Url(encodedSignature),
      encoder.encode(`${encodedHeader}.${encodedClaims}`),
    );
    if (!valid) return null;

    const claims = decodeJson<AccessClaims>(encodedClaims);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const email = claims.email?.trim().toLowerCase();
    const owners = setting(env, "OWNER_EMAILS").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!claims.sub || !email || !claims.exp || claims.exp <= Date.now() / 1000) return null;
    if (claims.iss?.replace(/\/$/, "") !== teamDomain || !audiences.includes(audience)) return null;
    if (!owners.includes(email)) return null;
    return { id: claims.sub, email };
  } catch (error) {
    console.error("Owner authentication failed", error);
    return null;
  }
}

export function isSameOriginWrite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === new URL(request.url).origin && (!fetchSite || fetchSite === "same-origin");
}

export function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("content-type", "application/json");
  headers.set("vary", "cf-access-jwt-assertion");
  return new Response(JSON.stringify(body), { ...init, headers });
}
