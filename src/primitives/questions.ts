import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from "../core/types.js";

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} 不能为空。`);
  }
}

export function choice(
  instructions: string,
  criteria: Record<string, string | null>,
): ChoiceQuestion {
  requireNonEmpty(instructions, "Choice instructions");
  const entries = Object.entries(criteria);
  if (entries.length < 2 || entries.length > 255) {
    throw new Error("Choice 选项数量必须在 2 到 255 之间。");
  }
  for (const [key, description] of entries) {
    requireNonEmpty(key, "Choice key");
    if (description !== null) requireNonEmpty(description, `Choice ${key} description`);
  }
  return { type: "choice", instructions, criteria };
}

export function noul(
  instructions: string,
  criteria: { true: string; false: string },
): NoulQuestion {
  requireNonEmpty(instructions, "Noul instructions");
  requireNonEmpty(criteria.true, "Noul true criterion");
  requireNonEmpty(criteria.false, "Noul false criterion");
  return { type: "noul", instructions, criteria };
}

export function score(instructions: string, criteria: string[]): ScoreQuestion {
  requireNonEmpty(instructions, "Score instructions");
  if (criteria.length < 2) throw new Error("Score 至少需要两个等级。");
  criteria.forEach((criterion, index) => requireNonEmpty(criterion, `Score criterion ${index}`));
  return { type: "score", instructions, criteria };
}
