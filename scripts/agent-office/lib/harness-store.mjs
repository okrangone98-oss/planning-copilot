import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const RUN_ID_PATTERN = /^run-[A-Za-z0-9][A-Za-z0-9-]{5,79}$/;

export async function createRunStore({ outputRoot = "reports/private", runId }) {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("실행 ID 형식이 올바르지 않습니다.");
  }

  const root = path.resolve(outputRoot);
  const runDir = path.join(root, "runs", runId);
  const artifactDir = path.join(runDir, "artifacts");
  await fs.mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await setOwnerOnly(runDir, true);
  await setOwnerOnly(artifactDir, true);

  return {
    runDir,
    async writeManifest(manifest) {
      await writeJsonAtomic(path.join(runDir, "manifest.json"), manifest);
    },
    async appendEvent(event) {
      const filePath = path.join(runDir, "events.jsonl");
      await fs.appendFile(filePath, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
      await setOwnerOnly(filePath);
    },
    async writeArtifact(name, content) {
      if (typeof name !== "string" || name !== path.basename(name) || name.includes("..") || path.isAbsolute(name)) {
        throw new Error("산출물은 안전한 파일명만 사용할 수 있습니다.");
      }
      const filePath = path.join(artifactDir, name);
      await writePrivateFile(filePath, String(content));
      return path.posix.join("artifacts", name);
    },
    async writeSnapshot(snapshot) {
      await writeJsonAtomic(path.join(runDir, "snapshot.json"), snapshot);
      await writeJsonAtomic(path.join(root, "control-tower-latest.json"), snapshot);
    }
  };
}

async function writeJsonAtomic(filePath, value) {
  await writePrivateFile(filePath, JSON.stringify(value, null, 2) + "\n", true);
}

async function writePrivateFile(filePath, contents, atomic = false) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const target = atomic ? filePath + ".tmp-" + randomUUID() : filePath;
  try {
    await fs.writeFile(target, contents, { encoding: "utf8", mode: 0o600 });
    await setOwnerOnly(target);
    if (atomic) await fs.rename(target, filePath);
    await setOwnerOnly(filePath);
  } catch (error) {
    if (atomic) await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

async function setOwnerOnly(filePath, directory = false) {
  if (process.platform === "win32") return;
  await fs.chmod(filePath, directory ? 0o700 : 0o600);
}
