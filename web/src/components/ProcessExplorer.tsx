"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  ProcessLaneGroup,
  ProcessModel,
  SourceVerification,
} from "@/lib/types";
import { trackEvent } from "@/lib/client-events";
import ProcessBoard from "./ProcessBoard";

type ProcessMode = "summary" | "full";
type ProcessLayout = "portrait" | "landscape";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function ProcessExplorer({
  process,
  verification,
  slug,
  laneGroups,
}: {
  process: ProcessModel;
  verification?: SourceVerification;
  slug: string;
  laneGroups?: ProcessLaneGroup[];
}) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<ProcessMode>(() =>
    searchParams.get("process") === "summary" ? "summary" : "full"
  );
  const [layout, setLayout] = useState<ProcessLayout>(() =>
    searchParams.get("layout") === "landscape" ? "landscape" : "portrait"
  );
  const [isMobile, setIsMobile] = useState(false);
  const initialNodeId = searchParams.get("node") ?? undefined;
  const imageHref = `${BASE_PATH}/exports/process-maps/${slug}.png`;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const updateMobileState = () => setIsMobile(query.matches);

    updateMobileState();
    query.addEventListener("change", updateMobileState);
    return () => query.removeEventListener("change", updateMobileState);
  }, []);

  const effectiveMode = isMobile ? "full" : mode;
  const effectiveLayout = isMobile ? "portrait" : layout;

  function selectMode(nextMode: ProcessMode) {
    setMode(nextMode);
    updateDetailUrl("process", nextMode === "summary" ? "summary" : "");
    trackEvent("process_mode", { slug, mode: nextMode });
  }

  function handleNodeChange(nodeId: string | null) {
    updateDetailUrl("node", nodeId ?? "");
    if (nodeId) trackEvent("process_node_open", { slug, node_id: nodeId });
  }

  function selectLayout(nextLayout: ProcessLayout) {
    setLayout(nextLayout);
    updateDetailUrl("layout", nextLayout === "landscape" ? "landscape" : "");
    trackEvent("process_layout", { slug, layout: nextLayout });
  }

  return (
    <div className="process-explorer">
      <div className="process-mode-bar">
        <div className="process-view-controls">
          <div
            className="process-mode-control"
            role="group"
            aria-label="업무구조도 표시 범위"
          >
            <button
              type="button"
              aria-pressed={mode === "full"}
              onClick={() => selectMode("full")}
            >
              전체 구조도
            </button>
            <button
              type="button"
              aria-pressed={mode === "summary"}
              onClick={() => selectMode("summary")}
            >
              핵심 흐름
            </button>
          </div>

          {mode === "full" && (
            <div
              className="process-mode-control process-layout-control"
              role="group"
              aria-label="업무구조도 방향"
            >
              <button
                type="button"
                aria-pressed={layout === "portrait"}
                onClick={() => selectLayout("portrait")}
              >
                세로형
              </button>
              <button
                type="button"
                aria-pressed={layout === "landscape"}
                onClick={() => selectLayout("landscape")}
              >
                가로형
              </button>
            </div>
          )}

          <a
            className="process-image-link"
            href={imageHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("process_image_open", { slug })}
          >
            세로형 PNG <span aria-hidden="true">↗</span>
          </a>
        </div>
        <p>
          {mode === "summary"
            ? "핵심·병목·회귀 노드를 먼저 표시합니다."
            : layout === "portrait"
              ? "단계 순서와 행위자별 책임을 세로 흐름으로 표시합니다."
              : "원래 행위자 레인과 단계 열을 가로로 표시합니다."}
        </p>
      </div>

      <ProcessBoard
        process={process}
        verification={verification}
        compact={effectiveMode === "summary"}
        layout={effectiveLayout}
        laneGroups={laneGroups}
        initialNodeId={initialNodeId}
        onNodeChange={handleNodeChange}
      />
    </div>
  );
}

function updateDetailUrl(key: string, value: string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
