import { appPath } from "@/lib/paths";

// Protect /fathers/admin with the Cloudflare Access owner policy. Access sets
// the signed cookie before this route redirects back to the public gallery.
export function GET(request: Request) {
  return new Response(null, {
    status: 302,
    headers: { location: new URL(appPath("/"), request.url).href, "cache-control": "private, no-store" },
  });
}
