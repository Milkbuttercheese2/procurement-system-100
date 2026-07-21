// 별표 본문을 내려받아 파싱한다.
//
// 앞서 별표는 제목과 링크만 담았다. HWP 표를 텍스트로 옮기면 행·열 관계가 깨져
// 어설픈 텍스트가 오히려 틀린 근거가 된다고 봤기 때문이다. kordoc이 병합셀까지
// 살려 HTML 표로 뽑아주는 것을 확인해서, 본문을 담는 쪽으로 바꾼다.
//
// 이게 왜 필요한가: "공사수행능력 신인도평가"처럼 답이 별표 안에만 있는 질문은
// 제도를 정확히 골라도 근거를 못 만들어 답변이 0건이었다. 제재기간·적격심사
// 배점처럼 실무에서 제일 자주 묻는 수치가 대부분 별표에 있다.
//
// 수집은 저작 시점에 한 번 한다. 운영(Worker)은 정적 자산만 읽는다.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "kordoc";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_FILE = path.join(WEB_DIR, "data", "annexes.json");
const OUT_FILE = path.join(WEB_DIR, "public", "annexes.json");

const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "annex-"));

// 표가 큰 별표가 있어 상한을 둔다. 넘치면 근거로 쓰기엔 너무 길고, Worker가
// 읽어 프롬프트에 싣는 비용도 감당이 안 된다.
const MAX_CHARS = 12000;

const out = {};
let ok = 0;
let failed = 0;
let truncated = 0;

for (const [key, meta] of Object.entries(index)) {
  if (!meta.fileUrl) {
    console.warn(`  ✗ ${key} — 파일 링크 없음`);
    failed += 1;
    continue;
  }
  try {
    const res = await fetch(meta.fileUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    // kordoc은 확장자로도 포맷을 판단하므로 실제 시그니처에 맞춰 붙인다.
    // d0cf11e0 = OLE(구 HWP 5.x), 504b = ZIP(HWPX/DOCX), 25504446 = PDF
    const sig = buf.subarray(0, 4).toString("hex");
    const ext =
      sig.startsWith("d0cf11e0") ? "hwp"
      : sig.startsWith("504b") ? "hwpx"
      : sig.startsWith("25504446") ? "pdf"
      : "hwp";
    const file = path.join(tmp, `${ok + failed}.${ext}`);
    fs.writeFileSync(file, buf);

    const parsed = await parse(file);
    let text = String(parsed?.markdown ?? parsed?.text ?? "").trim();
    if (!text) throw new Error("본문이 비어 있음");
    if (text.length > MAX_CHARS) {
      text = `${text.slice(0, MAX_CHARS)}\n\n…(이하 생략 — 전문은 원문 링크에서 확인)`;
      truncated += 1;
    }

    out[key] = { ...meta, text };
    ok += 1;
    console.log(`  ✓ ${key} — ${text.length}자`);
  } catch (error) {
    console.warn(`  ✗ ${key} — ${error.message}`);
    // 실패해도 제목·링크는 남긴다. 본문이 없다고 안내조차 못 하면 안 된다.
    out[key] = { ...meta };
    failed += 1;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out));
const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
console.log(
  `별표 본문: 성공 ${ok}건 / 실패 ${failed}건 / 길이초과 잘림 ${truncated}건 — ${kb}KB → public/annexes.json`,
);
