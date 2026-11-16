import roleDefinitions from "./agentRoles.json";
import type { AgentRole } from "../types";

export const agentRoles: AgentRole[] = roleDefinitions as AgentRole[];

export function getAgentRole(id: AgentRole["id"]) {
  return agentRoles.find((role) => role.id === id);
}
