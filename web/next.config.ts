import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // STATIC_EXPORT=1 이면 정적 내보내기(GitHub Pages), 없으면 서버 모드(Cloudflare).
  // 서버 모드여야 /api/route-institution 라우트 핸들러가 동작하고, 그래야
  // ANTHROPIC_API_KEY가 브라우저 번들에 들어가지 않는다.
  output: process.env.STATIC_EXPORT ? "export" : undefined,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
