import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["sharp", "cheerio"],
  images: {
    // IR demo serves public blobs through /api/ir/asset?p=&b=. Next 16
    // rejects query strings on local Image src unless listed here.
    localPatterns: [{ pathname: "/api/ir/asset" }],
    // Optimizer fetches without the IR cookie and would 401; the
    // browser already sends the cookie on the raw /api/ir/asset URL.
    unoptimized: process.env.NEXT_PUBLIC_IR_DEMO === "true",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/render/image/public/**",
      },
    ],
  },
};

export default nextConfig;
