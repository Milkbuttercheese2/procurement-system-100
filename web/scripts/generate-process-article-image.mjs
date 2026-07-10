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

const WIDTH = 1800;
const HEIGHT = 2400;
const GRID_LEFT = 38;
const GRID_RIGHT = 1762;
const GRID_TOP = 270;
const LANE_HEADER_HEIGHT = 100;
const STAGE_LABEL_WIDTH = 190;
const LANE_X = GRID_LEFT + STAGE_LABEL_WIDTH;
const LANE_WIDTH = (GRID_RIGHT - LANE_X) / 4;
const STAGE_HEIGHTS = [144, 160, 272, 166, 238, 410, 160, 272];
const CARD_WIDTH = 278;
const CARD_HEIGHT = 100;
const CARD_GAP = 40;
const ARROW_CLEARANCE = 8;

const GROUPS = [
  {
    title: "사업 준비·작성",
    detail: ["사업자·시행자", "평가대행자"],
    lanes: ["사업자/시행자", "평가대행자"],
    accent: "#0f9f72",
  },
  {
    title: "승인·공고",
    detail: ["승인기관", "관할 지자체"],
    lanes: ["승인기관", "관할 지자체"],
    accent: "#3b82f6",
  },
  {
    title: "협의·전문검토",
    detail: ["협의기관·위원회", "전문검토기관"],
    lanes: ["협의기관", "위원회/협의회", "전문검토기관/관계기관"],
    accent: "#c78116",
  },
  {
    title: "주민·정보공개",
    detail: ["주민·이해관계자", "정보시스템"],
    lanes: ["주민/이해관계자", "정보시스템"],
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

const stageTops = [];
let currentY = GRID_TOP + LANE_HEADER_HEIGHT;
for (const stageHeight of STAGE_HEIGHTS) {
  stageTops.push(currentY);
  currentY += stageHeight;
}
const GRID_BOTTOM = currentY;

const nodesByCell = new Map();
for (const node of process.nodes) {
  const groupIndex = groupByLane.get(node.lane);
  const rowIndex = stageIndex.get(node.stage);
  if (groupIndex === undefined || rowIndex === undefined) {
    throw new Error(`배치할 수 없는 노드: ${node.id}`);
  }
  const key = `${rowIndex}:${groupIndex}`;
  const cell = nodesByCell.get(key) ?? [];
  cell.push(node);
  nodesByCell.set(key, cell);
}

const layout = new Map();
for (const [key, cellNodes] of nodesByCell) {
  const [rowIndex, groupIndex] = key.split(":").map(Number);
  const totalHeight =
    cellNodes.length * CARD_HEIGHT + (cellNodes.length - 1) * CARD_GAP;
  const firstY = stageTops[rowIndex] + (STAGE_HEIGHTS[rowIndex] - totalHeight) / 2;
  const x =
    LANE_X +
    groupIndex * LANE_WIDTH +
    (LANE_WIDTH - CARD_WIDTH) / 2;

  cellNodes.forEach((node, index) => {
    layout.set(node.id, {
      x,
      y: firstY + index * (CARD_HEIGHT + CARD_GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      groupIndex,
      stageIndex: rowIndex,
    });
  });
}

// 보완 작성(P13)을 판단(P12)과 같은 높이에 두어 회귀선을 수평으로 읽게 한다.
layout.get("P13").y = layout.get("P12").y;

if (layout.size !== process.nodes.length) {
  throw new Error(`노드 배치 누락: ${layout.size}/${process.nodes.length}`);
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
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<defs>
      <filter id="card-shadow" x="-20%" y="-25%" width="140%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#12271e" flood-opacity="0.10"/>
      </filter>
      ${arrowMarker("arrow-sequence", "#53675d")}
      ${arrowMarker("arrow-message", "#0f8a65")}
      ${arrowMarker("arrow-loop", "#3478db")}
      <style>
        text { font-family: "Apple SD Gothic Neo", "Noto Sans CJK KR", "Noto Sans KR", sans-serif; }
        .mono { font-family: "SFMono-Regular", "Menlo", monospace; }
      </style>
    </defs>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f6f9f7"/>`,
    `<rect x="0" y="0" width="${WIDTH}" height="14" fill="#087452"/>`,
    renderHeader(),
    renderGrid(),
    renderEdges(),
    ...process.nodes.map(renderNode),
    renderFooter(),
    `</svg>`,
  ].join("\n");
}

function arrowMarker(id, color) {
  return `<marker id="${id}" markerWidth="18" markerHeight="14" refX="16" refY="7" orient="auto" markerUnits="userSpaceOnUse">
    <path d="M1,1 L17,7 L1,13 Z" fill="${color}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>
  </marker>`;
}

function renderHeader() {
  return `
    <text x="40" y="52" font-size="20" font-weight="750" fill="#087452">대한민국 제도 100 · 법령 기준 업무구조도</text>
    <text x="40" y="112" font-size="54" font-weight="800" fill="#111b16">환경영향평가 업무구조도</text>
    <text x="40" y="160" font-size="23" font-weight="520" fill="#526159">사업 대상 판정부터 사후환경영향조사까지, 책임 주체와 보완 회귀를 위에서 아래로 읽습니다.</text>
    <text x="40" y="209" font-size="18" font-weight="750" fill="#18251e">18개 업무 · 8단계 · 9개 행위자</text>
    <text x="520" y="209" font-size="17" fill="#67766e">법령 기준일 ${escapeXml(raw.asOfDate)}</text>
    <text x="1760" y="209" text-anchor="end" font-size="17" font-weight="700" fill="#a65f08">핵심 병목: 계절조사 · 보완 요구 회귀 · 주민 의견수렴</text>
    <line x1="40" y1="240" x2="1760" y2="240" stroke="#becbc4" stroke-width="2"/>
  `;
}

function renderGrid() {
  const result = [
    `<rect x="${GRID_LEFT}" y="${GRID_TOP}" width="${GRID_RIGHT - GRID_LEFT}" height="${GRID_BOTTOM - GRID_TOP}" rx="10" fill="#ffffff" stroke="#b8c7bf" stroke-width="2"/>`,
    `<rect x="${GRID_LEFT}" y="${GRID_TOP}" width="${STAGE_LABEL_WIDTH}" height="${LANE_HEADER_HEIGHT}" rx="10" fill="#eaf2ee"/>`,
    `<text x="58" y="309" font-size="18" font-weight="800" fill="#17231d">단계 ↓</text>`,
    `<text x="58" y="342" font-size="16" font-weight="650" fill="#68776f">책임 주체 →</text>`,
  ];

  process.stages.forEach((stage, rowIndex) => {
    const y = stageTops[rowIndex];
    const stageHeight = STAGE_HEIGHTS[rowIndex];
    const stageNodes = process.nodes.filter((node) => node.stage === stage);
    const hasCurrent = stageNodes.some((node) => node.status === "current");
    const allDone = stageNodes.every((node) => node.status === "done");
    const rowFill = hasCurrent
      ? "#f0faf5"
      : rowIndex % 2 === 0
        ? "#fbfcfb"
        : "#f5f8f6";
    const labelFill = hasCurrent
      ? "#087452"
      : allDone
        ? "#e4f5ed"
        : "#eef3f0";
    const labelInk = hasCurrent ? "#ffffff" : allDone ? "#087452" : "#53645b";
    const [code, ...labelParts] = stage.split(" ");

    result.push(
      `<rect x="${GRID_LEFT}" y="${y}" width="${GRID_RIGHT - GRID_LEFT}" height="${stageHeight}" fill="${rowFill}"/>`,
      `<rect x="${GRID_LEFT}" y="${y}" width="${STAGE_LABEL_WIDTH}" height="${stageHeight}" fill="${labelFill}"/>`,
      `<text x="58" y="${round(y + 34)}" class="mono" font-size="17" font-weight="800" fill="${labelInk}">${escapeXml(code)}</text>`,
      textLines(wrapText(labelParts.join(" "), 8, 2), 58, y + 69, {
        size: 21,
        weight: 800,
        fill: labelInk,
        lineHeight: 24,
      })
    );
  });

  GROUPS.forEach((group, groupIndex) => {
    const x = LANE_X + groupIndex * LANE_WIDTH;
    result.push(
      `<rect x="${round(x)}" y="${GRID_TOP}" width="${round(LANE_WIDTH)}" height="${LANE_HEADER_HEIGHT}" fill="#f7faf8"/>`,
      `<rect x="${round(x)}" y="${GRID_TOP}" width="${round(LANE_WIDTH)}" height="7" fill="${group.accent}"/>`,
      `<text x="${round(x + 22)}" y="311" font-size="23" font-weight="800" fill="#17231d">${escapeXml(group.title)}</text>`,
      textLines(group.detail, x + 22, 340, {
        size: 15.5,
        weight: 600,
        fill: "#68776f",
        lineHeight: 22,
      })
    );
  });

  for (let index = 0; index <= GROUPS.length; index += 1) {
    const x = LANE_X + index * LANE_WIDTH;
    result.push(
      `<line x1="${round(x)}" y1="${GRID_TOP}" x2="${round(x)}" y2="${GRID_BOTTOM}" stroke="#d3dcd7" stroke-width="1.5"/>`
    );
  }

  result.push(
    `<line x1="${GRID_LEFT}" y1="${GRID_TOP + LANE_HEADER_HEIGHT}" x2="${GRID_RIGHT}" y2="${GRID_TOP + LANE_HEADER_HEIGHT}" stroke="#b8c7bf" stroke-width="2"/>`
  );
  stageTops.forEach((y) => {
    result.push(
      `<line x1="${GRID_LEFT}" y1="${y}" x2="${GRID_RIGHT}" y2="${y}" stroke="#c8d3cd" stroke-width="1.5"/>`
    );
  });
  result.push(
    `<line x1="${GRID_LEFT}" y1="${GRID_BOTTOM}" x2="${GRID_RIGHT}" y2="${GRID_BOTTOM}" stroke="#b8c7bf" stroke-width="2"/>`
  );
  return result.join("\n");
}

function renderEdges() {
  const result = [];
  for (const edge of process.edges) {
    const source = layout.get(edge.source);
    const target = layout.get(edge.target);
    if (!source || !target) {
      throw new Error(`연결 배치 누락: ${edge.id}`);
    }
    const style =
      edge.type === "loop"
        ? { color: "#3478db", width: 4.2, dash: "10 8", marker: "arrow-loop" }
        : edge.type === "message"
          ? { color: "#0f8a65", width: 3.6, dash: "11 8", marker: "arrow-message" }
          : { color: "#53675d", width: 3.6, dash: "", marker: "arrow-sequence" };
    const route = edgeRoute(edge, source, target);
    result.push(
      `<path d="${route.path}" fill="none" stroke="${style.color}" stroke-width="${style.width}" ${style.dash ? `stroke-dasharray="${style.dash}"` : ""} marker-end="url(#${style.marker})" stroke-linecap="round" stroke-linejoin="round" opacity="0.96"/>`
    );
    if (edge.label) {
      const labelWidth = Math.max(104, Array.from(edge.label).length * 15 + 28);
      result.push(
        `<rect x="${round(route.labelX - labelWidth / 2)}" y="${round(route.labelY - 16)}" width="${labelWidth}" height="32" rx="6" fill="#ffffff" stroke="${style.color}" stroke-width="1.5"/>`,
        `<text x="${round(route.labelX)}" y="${round(route.labelY + 5)}" text-anchor="middle" font-size="15" font-weight="750" fill="${style.color}">${escapeXml(edge.label)}</text>`
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
  const sourceRight = source.x + source.width;
  const targetRight = target.x + target.width;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;

  if (edge.id === "E07") {
    const channelY = stageTops[source.stageIndex] + STAGE_HEIGHTS[source.stageIndex] - 14;
    return {
      path: `M ${round(sourceCenterX)} ${round(sourceBottom)} V ${round(channelY)} H ${round(targetCenterX)} V ${round(targetBottom + ARROW_CLEARANCE)}`,
      labelX: (sourceCenterX + targetCenterX) / 2,
      labelY: channelY - 18,
    };
  }

  if (edge.id === "L02") {
    const railX = LANE_X - 12;
    const channelY = targetBottom + 30;
    return {
      path: `M ${round(source.x)} ${round(sourceCenterY)} H ${round(railX)} V ${round(channelY)} H ${round(targetCenterX)} V ${round(targetBottom + ARROW_CLEARANCE)}`,
      labelX: railX + 72,
      labelY: (sourceCenterY + channelY) / 2,
    };
  }

  if (edge.id === "M03") {
    const sideX = sourceRight + 34;
    return {
      path: `M ${round(sourceRight)} ${round(sourceCenterY)} H ${round(sideX)} V ${round(targetCenterY)} H ${round(targetRight + ARROW_CLEARANCE)}`,
      labelX: sideX + 70,
      labelY: (sourceCenterY + targetCenterY) / 2,
    };
  }

  if (edge.id === "M01" || edge.id === "M02") {
    const offset = edge.id === "M01" ? -24 : 24;
    const startX = sourceCenterX + offset;
    const endX = targetCenterX + offset;
    const channelY = stageTops[target.stageIndex] + 14;
    return {
      path: `M ${round(startX)} ${round(sourceBottom)} V ${round(channelY)} H ${round(endX)} V ${round(target.y - ARROW_CLEARANCE)}`,
      labelX: (startX + endX) / 2,
      labelY: channelY - 18,
    };
  }

  if (source.stageIndex === target.stageIndex) {
    if (source.groupIndex === target.groupIndex) {
      const downward = target.y > source.y;
      return {
        path: downward
          ? `M ${round(sourceCenterX)} ${round(sourceBottom)} V ${round(target.y - ARROW_CLEARANCE)}`
          : `M ${round(sourceCenterX)} ${round(source.y)} V ${round(targetBottom + ARROW_CLEARANCE)}`,
        labelX: sourceRight + 65,
        labelY: (sourceCenterY + targetCenterY) / 2,
      };
    }

    if (target.x > source.x) {
      return {
        path: `M ${round(sourceRight)} ${round(sourceCenterY)} L ${round(target.x - ARROW_CLEARANCE)} ${round(targetCenterY)}`,
        labelX: (sourceRight + target.x) / 2,
        labelY: (sourceCenterY + targetCenterY) / 2 - 24,
      };
    }

    return {
      path: `M ${round(source.x)} ${round(sourceCenterY)} L ${round(targetRight + ARROW_CLEARANCE)} ${round(targetCenterY)}`,
      labelX: (source.x + targetRight) / 2,
      labelY: (sourceCenterY + targetCenterY) / 2 - 24,
    };
  }

  const channelY = stageTops[target.stageIndex];
  return {
    path: `M ${round(sourceCenterX)} ${round(sourceBottom)} V ${round(channelY)} H ${round(targetCenterX)} V ${round(target.y - ARROW_CLEARANCE)}`,
    labelX: (sourceCenterX + targetCenterX) / 2,
    labelY: channelY - 18,
  };
}

function renderNode(node) {
  const position = layout.get(node.id);
  const status = STATUS[node.status] ?? STATUS.waiting;
  const x = position.x;
  const y = position.y;
  const statusWidth = 54;
  const nameLines = wrapText(node.name, 11, 2);
  const footer = node.blocker ? `⚠ ${node.blocker}` : node.actor;
  const footerColor = node.blocker
    ? node.status === "current"
      ? "#fff0bc"
      : "#a96008"
    : status.sub;
  const idPrefix = node.type === "gateway" ? "◇ " : node.type === "system" ? "▣ " : "";

  return `
    <g filter="url(#card-shadow)">
      <rect x="${round(x)}" y="${round(y)}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="8" fill="${status.fill}" stroke="${status.border}" stroke-width="2.4"/>
      <rect x="${round(x)}" y="${round(y)}" width="6" height="${CARD_HEIGHT}" rx="3" fill="${status.border}"/>
      <text x="${round(x + 16)}" y="${round(y + 23)}" class="mono" font-size="14.5" font-weight="750" fill="${status.sub}">${idPrefix}${escapeXml(node.id)}</text>
      <rect x="${round(x + CARD_WIDTH - statusWidth - 11)}" y="${round(y + 9)}" width="${statusWidth}" height="26" rx="5" fill="${node.status === "current" ? "#ffffff" : status.border}" opacity="${node.status === "current" ? 0.18 : 0.14}"/>
      <text x="${round(x + CARD_WIDTH - statusWidth / 2 - 11)}" y="${round(y + 28)}" text-anchor="middle" font-size="14" font-weight="800" fill="${status.ink}">${status.label}</text>
      ${textLines(nameLines, x + 16, y + 51, {
        size: 20.5,
        weight: 800,
        fill: status.ink,
        lineHeight: 22,
      })}
      <text x="${round(x + 16)}" y="${round(y + 89)}" font-size="14.5" font-weight="650" fill="${footerColor}">${escapeXml(truncate(footer, 17))}</text>
    </g>
  `;
}

function renderFooter() {
  const legendY = 2245;
  return `
    <text x="38" y="${legendY}" font-size="17" font-weight="800" fill="#18251e">읽는 법</text>
    ${legendStatus(120, legendY - 14, "#35a77d", "선행")}
    ${legendStatus(220, legendY - 14, "#087452", "핵심")}
    ${legendStatus(320, legendY - 14, "#d9901a", "병목")}
    ${legendStatus(420, legendY - 14, "#3478db", "회귀")}
    <line x1="560" y1="${legendY - 8}" x2="612" y2="${legendY - 8}" stroke="#53675d" stroke-width="4" marker-end="url(#arrow-sequence)"/>
    <text x="632" y="${legendY - 2}" font-size="16" fill="#526159">절차 순서</text>
    <line x1="782" y1="${legendY - 8}" x2="834" y2="${legendY - 8}" stroke="#0f8a65" stroke-width="4" stroke-dasharray="10 8" marker-end="url(#arrow-message)"/>
    <text x="854" y="${legendY - 2}" font-size="16" fill="#526159">정보 전달</text>
    <line x1="1004" y1="${legendY - 8}" x2="1056" y2="${legendY - 8}" stroke="#3478db" stroke-width="4" stroke-dasharray="10 8" marker-end="url(#arrow-loop)"/>
    <text x="1076" y="${legendY - 2}" font-size="16" fill="#526159">보완 회귀</text>
    <text x="38" y="2292" font-size="16.5" font-weight="650" fill="#56655d">세로 읽기: 단계는 위→아래, 책임 주체는 좌→우입니다.</text>
    <text x="38" y="2323" font-size="15.5" fill="#68776f">설명글 가독성을 위해 원래 9개 행위자 레인을 4개 주체 묶음으로 편집했으며, 18개 업무와 20개 연결 관계는 유지했습니다.</text>
    <text x="38" y="2364" font-size="14.5" fill="#7b8881">출처: 환경영향평가법·시행령·시행규칙 기반 제도 모델 · 실제 사건의 진행 상태나 법률 자문을 의미하지 않습니다.</text>
    <text x="1762" y="2364" text-anchor="end" font-size="18" font-weight="750" fill="#087452">korea100 · 대한민국 제도 100</text>
  `;
}

function legendStatus(x, y, color, label) {
  return `<rect x="${x}" y="${y - 12}" width="17" height="17" rx="4" fill="${color}"/><text x="${x + 26}" y="${y + 2}" font-size="15.5" fill="#526159">${label}</text>`;
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
