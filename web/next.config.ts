import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // STATIC_EXPORT=1 이면 정적 내보내기(GitHub Pages), 없으면 standalone(Cloudflare).
  // 서버 모드여야 /api/route-institution 라우트 핸들러가 동작하고, 그래야 API 키가
  // 브라우저 번들에 들어가지 않는다.
  //
  // standalone이어야 하는 이유: @opennextjs/cloudflare가 .next/standalone/ 을 읽어
  // 워커 번들을 만든다. undefined로 두면 그 디렉터리가 없어 어댑터가
  // "ENOENT .next/standalone/.next/server/pages-manifest.json" 으로 실패한다.
  output: process.env.STATIC_EXPORT ? "export" : "standalone",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

// 로컬 `next dev`에서 Cloudflare 워커 바인딩을 주입한다(어댑터가 추가한 훅).
// 정적 내보내기 빌드에는 불필요하므로 건너뛴다.
if (!process.env.STATIC_EXPORT) {
  void import("@opennextjs/cloudflare").then((m) =>
    m.initOpenNextCloudflareForDev(),
  );
}
