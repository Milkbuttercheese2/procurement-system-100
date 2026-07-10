import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const inputPath = path.join(
  webRoot,
  "data/institutions/environmental-impact-assessment.json"
);
const outputPath = path.join(
  webRoot,
  "public/exports/environmental-impact-assessment-process-map.png"
);

const WIDTH = 2400;
const HEIGHT = 1800;
const GRID_X = 304;
const GRID_Y = 340;
const GRID_RIGHT = 2360;
const STAGE_WIDTH = (GRID_RIGHT - GRID_X) / 8;
const CARD_WIDTH = STAGE_WIDTH - 28;
const CARD_HEIGHT = 135;
const CARD_GAP = 10;

const GROUPS = [
  {
    title: "사업 준비·작성",
    detail: ["사업자·시행자", "평가대행자"],
    lanes: ["사업자/시행자", "평가대행자"],
    height: 340,
    accent: "#0f9f72",
  },
  {
    title: "승인·공고",
    detail: ["승인기관", "관할 지자체"],
    lanes: ["승인기관", "관할 지자체"],
    height: 200,
    accent: "#3b82f6",
  },
  {
    title: "협의·전문검토",
    detail: ["협의기관·위원회", "전문검토기관"],
    lanes: ["협의기관", "위원회/협의회", "전문검토기관/관계기관"],
    height: 490,
    accent: "#c78116",
  },
  {
    title: "주민·정보공개",
    detail: ["주민·이해관계자", "정보시스템"],
    lanes: ["주민/이해관계자", "정보시스템"],
    height: 200,
    accent: "#0891b2",
  },
];

const STATUS = {
  done: {
    label: "선행",
    fill: "#effaf5",
    border: "#35a77d",
    ink: "#123d2e",
    sub: "#287a5c",
  },
  current: {
    label: "핵심",
    fill: "#087452",
    border: "#087452",
    ink: "#ffffff",
    sub: "#d8f4e8",
  },
  waiting: {
    label: "후속",
    fill: "#ffffff",
    border: "#b9c7bf",
    ink: "#17231d",
    sub: "#627169",
  },
  risk: {
    label: "병목",
    fill: "#fff8e8",
    border: "#d9901a",
    ink: "#7a4305",
    sub: "#a96008",
  },
  loop: {
    label: "회귀",
    fill: "#edf4ff",
    border: "#3478db",
    ink: "#173f7a",
    sub: "#316bbd",
  },
};

const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const process = raw.process;
const groupByLane = new Map(
  GROUPS.flatMap((group, groupIndex) =>
    group.lanes.map((lane) => [lane, groupIndex])
  )
);
const stageIndex = new Map(process.stages.map((stage, index) => [stage, index]));

const rowTops = [];
let currentY = GRID_Y;
for (const group of GROUPS) {
  rowTops.push(currentY);
  currentY += group.height;
}

const nodesByCell = new Map();
for (const node of process.nodes) {
  const groupIndex = groupByLane.get(node.lane);
  const columnIndex = stageIndex.get(node.stage);
  const key = `${groupIndex}:${columnIndex}`;
  const cell = nodesByCell.get(key) ?? [];
  cell.push(node);
  nodesByCell.set(key, cell);
}

const layout = new Map();
for (const [key, cellNodes] of nodesByCell) {
  const [groupIndex, columnIndex] = key.split(":").map(Number);
  const x = GRID_X + columnIndex * STAGE_WIDTH + 14;
  const firstY = rowTops[groupIndex] + 44;
  cellNodes.forEach((node, index) => {
    layout.set(node.id, {
      x,
      y: firstY + index * (CARD_HEIGHT + CARD_GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      groupIndex,
      columnIndex,
    });
  });
}

const svg = renderSvg();
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await sharp(Buffer.from(svg), { density: 144 })
  .resize(WIDTH, HEIGHT)
  .png({ compressionLevel: 9, quality: 100 })
  .toFile(outputPath);

const metadata = await sharp(outputPath).metadata();
console.log(
  `설명글용 업무구조도 생성: ${outputPath} (${metadata.width}x${metadata.height})`
);

function renderSvg() {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<defs>
      <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#12271e" flood-opacity="0.10"/>
      </filter>
      <marker id="arrow-sequence" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M1,1 L13,6 L1,11 Z" fill="#53675d"/>
      </marker>
      <marker id="arrow-message" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M1,1 L13,6 L1,11 Z" fill="#0f8a65"/>
      </marker>
      <marker id="arrow-loop" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M1,1 L13,6 L1,11 Z" fill="#3478db"/>
      </marker>
      <style>
        text { font-family: "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", sans-serif; }
        .mono { font-family: "SFMono-Regular", "Menlo", monospace; }
      </style>
    </defs>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f6f9f7"/>`,
    `<rect x="0" y="0" width="${WIDTH}" height="16" fill="#087452"/>`,
    renderHeader(),
    renderGrid(),
    renderEdges(),
    ...process.nodes.map(renderNode),
    renderFooter(),
    `</svg>`,
  ];
  return parts.join("\n");
}

function renderHeader() {
  return `
    <text x="42" y="62" font-size="22" font-weight="750" fill="#087452" letter-spacing="1.2">대한민국 제도 100 · 법령 기준 업무구조도</text>
    <text x="42" y="132" font-size="60" font-weight="800" fill="#111b16">환경영향평가 업무구조도</text>
    <text x="42" y="184" font-size="27" font-weight="520" fill="#526159">사업 대상 판정부터 사후환경영향조사까지, 주체별 책임과 보완 회귀를 한 장으로 읽습니다.</text>
    <text x="2358" y="84" text-anchor="end" font-size="20" font-weight="750" fill="#18251e">18개 업무 · 8단계 · 9개 행위자</text>
    <text x="2358" y="119" text-anchor="end" font-size="18" fill="#67766e">법령 기준일 ${escapeXml(raw.asOfDate)}</text>
    <text x="2358" y="158" text-anchor="end" font-size="17" font-weight="650" fill="#a65f08">핵심 병목: 계절조사 · 보완 요구 회귀 · 주민 의견수렴</text>
    <line x1="42" y1="218" x2="2358" y2="218" stroke="#becbc4" stroke-width="2"/>
  `;
}

function renderGrid() {
  const result = [
    `<rect x="40" y="242" width="2320" height="${currentY - 242}" rx="14" fill="#ffffff" stroke="#b8c7bf" stroke-width="2"/>`,
    `<rect x="40" y="242" width="264" height="98" rx="14" fill="#eaf2ee"/>`,
    `<text x="64" y="282" font-size="18" font-weight="750" fill="#526159">주체 묶음</text>`,
    `<text x="64" y="314" font-size="16" fill="#76857d">원래 9개 행위자 레인</text>`,
  ];

  process.stages.forEach((stage, index) => {
    const [code, ...labelParts] = stage.split(" ");
    const x = GRID_X + index * STAGE_WIDTH;
    const hasCurrent = process.nodes.some(
      (node) => node.stage === stage && node.status === "current"
    );
    const allDone = process.nodes
      .filter((node) => node.stage === stage)
      .every((node) => node.status === "done");
    const fill = hasCurrent ? "#087452" : allDone ? "#e4f5ed" : "#f4f7f5";
    const ink = hasCurrent ? "#ffffff" : allDone ? "#087452" : "#53645b";
    result.push(
      `<rect x="${round(x)}" y="242" width="${round(STAGE_WIDTH)}" height="98" fill="${fill}" stroke="#c7d2cc" stroke-width="1"/>`,
      `<text x="${round(x + 18)}" y="276" class="mono" font-size="19" font-weight="750" fill="${ink}">${escapeXml(code)}</text>`,
      textLines([labelParts.join(" ")], x + 18, 310, {
        size: 25,
        weight: 760,
        fill: ink,
        maxChars: 10,
        lineHeight: 28,
      })
    );
  });

  GROUPS.forEach((group, groupIndex) => {
    const y = rowTops[groupIndex];
    const fill = groupIndex % 2 === 0 ? "#fbfcfb" : "#f4f7f5";
    result.push(
      `<rect x="40" y="${y}" width="2320" height="${group.height}" fill="${fill}"/>`,
      `<rect x="40" y="${y}" width="264" height="${group.height}" fill="#eef3f0"/>`,
      `<rect x="40" y="${y}" width="8" height="${group.height}" fill="${group.accent}"/>`,
      `<line x1="40" y1="${y}" x2="2360" y2="${y}" stroke="#c8d3cd" stroke-width="2"/>`,
      `<text x="68" y="${y + 72}" font-size="29" font-weight="800" fill="#17231d">${escapeXml(group.title)}</text>`,
      textLines(group.detail, 68, y + 101, {
        size: 19,
        weight: 560,
        fill: "#68776f",
        lineHeight: 29,
      })
    );
  });

  for (let index = 0; index <= process.stages.length; index += 1) {
    const x = GRID_X + index * STAGE_WIDTH;
    result.push(
      `<line x1="${round(x)}" y1="242" x2="${round(x)}" y2="${currentY}" stroke="#d5ddd8" stroke-width="1.5"/>`
    );
  }
  result.push(
    `<line x1="40" y1="${currentY}" x2="2360" y2="${currentY}" stroke="#b8c7bf" stroke-width="2"/>`
  );
  return result.join("\n");
}

function renderEdges() {
  const result = [];
  for (const edge of process.edges) {
    const source = layout.get(edge.source);
    const target = layout.get(edge.target);
    if (!source || !target) continue;
    const style =
      edge.type === "loop"
        ? { color: "#3478db", width: 4, dash: "9 7", marker: "arrow-loop" }
        : edge.type === "message"
          ? { color: "#0f8a65", width: 3, dash: "10 7", marker: "arrow-message" }
          : { color: "#53675d", width: 3.2, dash: "", marker: "arrow-sequence" };
    const route = edgeRoute(edge, source, target);
    result.push(
      `<path d="${route.path}" fill="none" stroke="${style.color}" stroke-width="${style.width}" ${style.dash ? `stroke-dasharray="${style.dash}"` : ""} marker-end="url(#${style.marker})" opacity="${edge.type === "sequence" ? 0.78 : 0.95}"/>`
    );
    if (edge.label) {
      const labelWidth = Math.max(104, Array.from(edge.label).length * 17 + 28);
      result.push(
        `<rect x="${round(route.labelX - labelWidth / 2)}" y="${round(route.labelY - 17)}" width="${labelWidth}" height="34" rx="7" fill="#ffffff" stroke="${style.color}" stroke-width="1.5"/>`,
        `<text x="${round(route.labelX)}" y="${round(route.labelY + 6)}" text-anchor="middle" font-size="16" font-weight="700" fill="${style.color}">${escapeXml(edge.label)}</text>`
      );
    }
  }
  return result.join("\n");
}

function edgeRoute(edge, source, target) {
  const sourceCenterX = source.x + source.width / 2;
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;

  if (
    source.columnIndex === target.columnIndex &&
    source.groupIndex === target.groupIndex
  ) {
    const downward = target.y > source.y;
    const startY = downward ? source.y + source.height : source.y;
    const endY = downward ? target.y : target.y + target.height;
    return {
      path: `M ${round(sourceCenterX)} ${round(startY)} L ${round(targetCenterX)} ${round(endY)}`,
      labelX: source.x - 60,
      labelY: (startY + endY) / 2,
    };
  }

  if (source.columnIndex === target.columnIndex) {
    const stageRight = GRID_X + (source.columnIndex + 1) * STAGE_WIDTH - 7;
    return {
      path: `M ${round(source.x + source.width)} ${round(sourceCenterY)} H ${round(stageRight)} V ${round(targetCenterY)} H ${round(target.x + target.width)}`,
      labelX: stageRight - 74,
      labelY: (sourceCenterY + targetCenterY) / 2,
    };
  }

  if (target.columnIndex > source.columnIndex) {
    const startX = source.x + source.width;
    const endX = target.x;
    const curve = Math.min(94, Math.max(44, (endX - startX) * 0.38));
    return {
      path: `M ${round(startX)} ${round(sourceCenterY)} C ${round(startX + curve)} ${round(sourceCenterY)}, ${round(endX - curve)} ${round(targetCenterY)}, ${round(endX)} ${round(targetCenterY)}`,
      labelX: (startX + endX) / 2,
      labelY: (sourceCenterY + targetCenterY) / 2 - 25,
    };
  }

  const startX = source.x;
  const endX = target.x + target.width;
  return {
    path: `M ${round(startX)} ${round(sourceCenterY)} C ${round(startX - 110)} ${round(sourceCenterY)}, ${round(endX + 110)} ${round(targetCenterY)}, ${round(endX)} ${round(targetCenterY)}`,
    labelX: (startX + endX) / 2,
    labelY: (sourceCenterY + targetCenterY) / 2 + 28,
  };
}

function renderNode(node) {
  const position = layout.get(node.id);
  const status = STATUS[node.status] ?? STATUS.waiting;
  const x = position.x;
  const y = position.y;
  const statusWidth = 58;
  const nameLines = wrapText(node.name, 10, 3);
  const footer = node.blocker ? `⚠ ${node.blocker}` : node.actor;
  const footerColor = node.blocker
    ? node.status === "current"
      ? "#fff0bc"
      : "#a96008"
    : status.sub;
  const idPrefix = node.type === "gateway" ? "◇ " : node.type === "system" ? "▣ " : "";

  return `
    <g filter="url(#card-shadow)">
      <rect x="${round(x)}" y="${round(y)}" width="${round(position.width)}" height="${CARD_HEIGHT}" rx="11" fill="${status.fill}" stroke="${status.border}" stroke-width="2.5"/>
      <rect x="${round(x)}" y="${round(y)}" width="7" height="${CARD_HEIGHT}" rx="4" fill="${status.border}"/>
      <text x="${round(x + 17)}" y="${round(y + 28)}" class="mono" font-size="16" font-weight="750" fill="${status.sub}">${idPrefix}${escapeXml(node.id)}</text>
      <rect x="${round(x + position.width - statusWidth - 12)}" y="${round(y + 11)}" width="${statusWidth}" height="29" rx="6" fill="${node.status === "current" ? "#ffffff" : status.border}" opacity="${node.status === "current" ? 0.18 : 0.14}"/>
      <text x="${round(x + position.width - statusWidth / 2 - 12)}" y="${round(y + 32)}" text-anchor="middle" font-size="15" font-weight="800" fill="${status.ink}">${status.label}</text>
      ${textLines(nameLines, x + 17, y + 61, {
        size: 23,
        weight: 800,
        fill: status.ink,
        lineHeight: 25,
      })}
      <text x="${round(x + 17)}" y="${round(y + 124)}" font-size="15.5" font-weight="650" fill="${footerColor}">${escapeXml(truncate(footer, 17))}</text>
    </g>
  `;
}

function renderFooter() {
  const y = 1630;
  return `
    <text x="42" y="${y}" font-size="17" font-weight="800" fill="#18251e">읽는 법</text>
    ${legendStatus(132, y - 15, "#35a77d", "선행")}
    ${legendStatus(242, y - 15, "#087452", "핵심")}
    ${legendStatus(352, y - 15, "#d9901a", "병목")}
    ${legendStatus(462, y - 15, "#3478db", "회귀")}
    <line x1="598" y1="${y - 9}" x2="654" y2="${y - 9}" stroke="#53675d" stroke-width="4" marker-end="url(#arrow-sequence)"/>
    <text x="670" y="${y - 3}" font-size="16" fill="#526159">절차 순서</text>
    <line x1="790" y1="${y - 9}" x2="846" y2="${y - 9}" stroke="#0f8a65" stroke-width="4" stroke-dasharray="9 7" marker-end="url(#arrow-message)"/>
    <text x="862" y="${y - 3}" font-size="16" fill="#526159">정보 전달</text>
    <line x1="982" y1="${y - 9}" x2="1038" y2="${y - 9}" stroke="#3478db" stroke-width="4" stroke-dasharray="9 7" marker-end="url(#arrow-loop)"/>
    <text x="1054" y="${y - 3}" font-size="16" fill="#526159">보완 회귀</text>
    <text x="42" y="1690" font-size="17" fill="#65736c">설명글 가독성을 위해 원래 9개 행위자 레인을 4개 주체 묶음으로 편집했습니다. 업무 노드와 연결 관계는 원본 모델을 유지합니다.</text>
    <text x="42" y="1732" font-size="16" fill="#7b8881">출처: 환경영향평가법·시행령·시행규칙 기반 제도 모델 · 실제 사건의 진행 상태나 법률 자문을 의미하지 않습니다.</text>
    <text x="2358" y="1730" text-anchor="end" font-size="19" font-weight="750" fill="#087452">korea100 · 대한민국 제도 100</text>
  `;
}

function legendStatus(x, y, color, label) {
  return `<rect x="${x}" y="${y - 13}" width="18" height="18" rx="4" fill="${color}"/><text x="${x + 27}" y="${y + 2}" font-size="16" fill="#526159">${label}</text>`;
}

function textLines(lines, x, y, options = {}) {
  const {
    size = 18,
    weight = 600,
    fill = "#17231d",
    lineHeight = size * 1.25,
    maxChars,
  } = options;
  const normalized = maxChars
    ? lines.flatMap((line) => wrapText(line, maxChars, 2))
    : lines;
  const tspans = normalized
    .map(
      (line, index) =>
        `<tspan x="${round(x)}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join("");
  return `<text x="${round(x)}" y="${round(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
}

function wrapText(text, maxChars, maxLines) {
  if (Array.from(text).length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (Array.from(candidate).length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (Array.from(word).length > maxChars) {
      const chars = Array.from(word);
      lines.push(chars.slice(0, maxChars).join(""));
      current = chars.slice(maxChars).join("");
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  const limited = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    limited[maxLines - 1] = `${Array.from(limited[maxLines - 1]).slice(0, maxChars - 1).join("")}…`;
  }
  return limited;
}

function truncate(text, maxChars) {
  const chars = Array.from(text);
  return chars.length <= maxChars
    ? text
    : `${chars.slice(0, maxChars - 1).join("")}…`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
