import { readFile } from "node:fs/promises";

export async function loadAliases(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeIdentityText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_/.]+/g, "")
    .trim();
}

export function resolveProjectId(value, aliases) {
  const normalized = normalizeIdentityText(value);
  if (!normalized || !aliases || typeof aliases !== "object") return undefined;

  const matches = [];
  for (const [projectId, projectAliases] of Object.entries(aliases)) {
    if (!Array.isArray(projectAliases)) continue;
    for (const alias of projectAliases) {
      const normalizedAlias = normalizeIdentityText(alias);
      if (normalizedAlias && normalized.includes(normalizedAlias)) {
        matches.push({ projectId, length: normalizedAlias.length });
      }
    }
  }

  return matches.sort((left, right) => right.length - left.length || left.projectId.localeCompare(right.projectId))[0]?.projectId;
}

export function attachProjectId(value, aliases) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (value.projectId) return value;

  const projectId = resolveProjectId(value.name || value.title || value.subject || "", aliases);
  return projectId ? { ...value, projectId } : value;
}
