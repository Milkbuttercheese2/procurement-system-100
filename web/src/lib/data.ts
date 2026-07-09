import fs from "fs";
import path from "path";
import type { Institution } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "institutions");

export function getAllInstitutions(): Institution[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const institutions = files.map((file) => {
    const content = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
    return JSON.parse(content) as Institution;
  });
  return institutions.sort((a, b) => a.priority - b.priority);
}

export function getInstitution(slug: string): Institution | null {
  const filePath = path.join(DATA_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as Institution;
}

export function getAllSlugs(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}
