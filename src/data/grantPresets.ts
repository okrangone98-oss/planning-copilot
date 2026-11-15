import presetDefinitions from "./grantPresets.json";
import type { GrantPreset } from "../types";

/** 국고보조사업 예산·정산·결과보고 프리셋. 값은 JSON에 두고 여기서 타입만 붙인다. */
export const grantPresets: GrantPreset[] = presetDefinitions.presets as GrantPreset[];
export const grantPresetUpdatedAt: string = presetDefinitions.updatedAt;

export function findGrantPreset(id: string): GrantPreset | undefined {
  return grantPresets.find((preset) => preset.id === id);
}
