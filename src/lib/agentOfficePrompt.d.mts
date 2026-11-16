export type OfficeContext = {
  text: string;
  sourceLabels: string[];
  truncated: boolean;
  characterCount: number;
};

export function buildOfficeContext(
  project: Record<string, unknown>,
  matches?: Array<{ title?: string; type?: string; chunk?: string }>
): OfficeContext;

export function buildOfficeModelPrompt(input: {
  command: string;
  tasks: Array<{ agentId: string; title: string; input: string }>;
  context: OfficeContext;
}): string;
