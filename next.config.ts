import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["sharp", "cheerio"],
  images: {
    // Next 16 treats localPatterns as a whitelist. Listing only the IR
    // proxy blocked `/theo-logo.png` (Header / TheoLoadingMark) on
    // production. Keep static public files allowed; the IR route is
    // the only local src that carries a query string.
    localPatterns: [
      { pathname: "/**", search: "" },
      { pathname: "/api/ir/asset" },
    ],
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
