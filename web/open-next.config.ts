import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// SSG 페이지(/model/[slug])는 incremental cache를 거쳐 제공된다. 캐시를 설정하지
// 않으면 그 경로가 통째로 404가 난다 — 실제로 배포 후 제도 상세 66개가 전부 404였고,
// 정적 라우트인 /, /verification, /request, /robots.txt 는 정상이었다.
// (빌드 로그의 "WARN Failed to set up cache for your project." 가 그 신호였다.)
//
// 이 사이트의 제도 페이지는 빌드 시점에 확정되고 런타임에 재생성되지 않으므로,
// R2·KV 버킷을 붙일 필요 없이 정적 자산에서 읽어오는 구현으로 충분하다.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
