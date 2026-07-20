// 배포된 워커가 어느 커밋인지 응답만 보고 알 수 있게 하는 스탬프.
// 배포가 반영됐는지 매번 추측하지 않으려고 둔다.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let sha = "unknown";
try {
  sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  // CI에서 git 정보가 없을 수 있다.
}
const stamp = { sha, builtAt: new Date().toISOString() };
fs.writeFileSync(path.join(WEB_DIR, "data", "build-stamp.json"), JSON.stringify(stamp) + "\n");
console.log(`빌드 스탬프: ${stamp.sha} @ ${stamp.builtAt}`);
