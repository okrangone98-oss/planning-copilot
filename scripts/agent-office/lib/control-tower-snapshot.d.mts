import type { ControlTowerSnapshot } from "../../../src/types";

export function buildControlTowerSnapshot(input: Partial<ControlTowerSnapshot> & { run: ControlTowerSnapshot["run"] }): ControlTowerSnapshot;
export function validateControlTowerSnapshot(value: unknown): { ok: true; value: ControlTowerSnapshot } | { ok: false; error: string };
export function parseControlTowerSnapshot(text: string): { ok: true; value: ControlTowerSnapshot } | { ok: false; error: string };
