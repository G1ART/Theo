import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { IR_DEMO_COOKIE, isIrDemo } from "@/lib/irDemo/config";
import { irDemoCookieIsValid } from "@/lib/irDemo/gate";

const BUCKETS = new Set(["artworks", "exhibition-media", "avatars", "spaces"]);

export async function GET(req: Request) {
  if (!isIrDemo()) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const jar = await cookies();
  if (!(await irDemoCookieIsValid(jar.get(IR_DEMO_COOKIE)?.value))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const path = searchParams.get("p") ?? "";
  const bucket = searchParams.get("b") ?? "artworks";
  if (!path || path.includes("..") || path.startsWith("/") || !BUCKETS.has(bucket)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const demoBase = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
  const prodOrigin = process.env.IR_DEMO_ASSET_ORIGIN?.replace(/\/$/, "") ?? "";

  const tryUrl = async (origin: string) => {
    if (!origin) return null;
    const res = await fetch(`${origin}/storage/v1/object/public/${bucket}/${encoded}`, {
      cache: "no-store",
    });
    if (!res.ok || !res.body) return null;
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=3600",
      },
    });
  };

  const local = await tryUrl(demoBase);
  if (local) return local;
  const fallback = await tryUrl(prodOrigin);
  if (fallback) return fallback;
  return new NextResponse("Not Found", { status: 404 });
}
