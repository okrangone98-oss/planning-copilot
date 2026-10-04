import type { ControlTowerApprovalStatus, ControlTowerSnapshot, ControlTowerState } from "../../../src/types";

export function loadControlTowerState(storage?: Storage): ControlTowerState;
export function saveControlTowerSnapshot(snapshot: ControlTowerSnapshot, storage?: Storage): ControlTowerState;
export function saveControlTowerApproval(runId: string, approvalId: string, status: ControlTowerApprovalStatus, storage?: Storage): ControlTowerState;
export function clearControlTowerState(storage?: Storage): void;
