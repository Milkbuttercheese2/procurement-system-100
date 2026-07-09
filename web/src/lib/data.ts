import fs from "fs";
import path from "path";
import type { Institution } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "institutions");
const MANIFEST_PATH = path.join(process.cwd(), "..", "docs", "institutions-100-manifest.json");

interface ManifestEntry {
  priority: number;
  slug: string;
  name: string;
  type: string;
  category: string;
}

function loadManifest(): ManifestEntry[] {
  if (!fs.existsSync(MANIFEST_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as ManifestEntry[];
  } catch {
    return [];
  }
}

function buildCategoryMap(): Map<string, string> {
  const manifest = loadManifest();
  const map = new Map<string, string>();
  for (const entry of manifest) {
    if (entry.slug && entry.category) {
      map.set(entry.slug, entry.category);
    }
  }
  return map;
}

export function getCategoryOrder(): string[] {
  const manifest = loadManifest();
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of manifest) {
    if (entry.category && !seen.has(entry.category)) {
      seen.add(entry.category);
      order.push(entry.category);
    }
  }
  return order;
}

export function getAllInstitutions(): Institution[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const categoryMap = buildCategoryMap();
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const institutions = files.map((file) => {
    const content = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
    const inst = JSON.parse(content) as Institution;
    if (!inst.category) {
      inst.category = categoryMap.get(inst.slug) ?? "기타";
    }
    return inst;
  });
  return institutions.sort((a, b) => a.priority - b.priority);
}

export function getInstitution(slug: string): Institution | null {
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const categoryMap = buildCategoryMap();
  const content = fs.readFileSync(filePath, "utf-8");
  const inst = JSON.parse(content) as Institution;
  if (!inst.category) {
    inst.category = categoryMap.get(slug) ?? "기타";
  }
  return inst;
}

export function getAllSlugs(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}
