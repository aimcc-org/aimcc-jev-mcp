import type {
  ChoiceQuestion,
  ChoiceSignal,
  DecisionSignal,
  NoulSignal,
  PrimitiveQuestion,
  ScoreQuestion,
  ScoreSignal,
} from "../core/types.js";

const SUM_TOLERANCE = 0.01 + 1e-12;
const SCORE_MEAN_TOLERANCE = 0.02 + 1e-12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function invalid(id: string, kind: PrimitiveQuestion["type"], errorCode: string): DecisionSignal {
  return {
    id,
    kind,
    status: "invalid_response",
    questionVersion: "1",
    errorCode,
  };
}

function validateDistribution(
  value: unknown,
  expectedKeys: string[],
): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    return undefined;
  }
  const distribution: Record<string, number> = {};
  for (const key of expectedKeys) {
    const probability = value[key];
    if (!isProbability(probability)) return undefined;
    distribution[key] = probability;
  }
  const sum = Object.values(distribution).reduce((total, probability) => total + probability, 0);
  return Math.abs(sum - 1) <= SUM_TOLERANCE ? distribution : undefined;
}

function marginOf(probabilities: Record<string, number>): number {
  const ranked = Object.values(probabilities).sort((a, b) => b - a);
  if (ranked.length < 2) return 0;
  return (ranked[0] ?? 0) - (ranked[1] ?? 0);
}

function validateChoice(id: string, question: ChoiceQuestion, answer: unknown): ChoiceSignal {
  if (!isRecord(answer) || answer.type !== "choice") {
    return invalid(id, "choice", "CHOICE_SHAPE_INVALID") as ChoiceSignal;
  }
  const keys = Object.keys(question.criteria);
  const selected = answer.choice;
  const probabilities = validateDistribution(answer.probabilities, keys);
  if (typeof selected !== "string" || !keys.includes(selected) || !probabilities) {
    return invalid(id, "choice", "CHOICE_VALUE_INVALID") as ChoiceSignal;
  }
  const max = Math.max(...Object.values(probabilities));
  if (probabilities[selected] !== max) {
    return invalid(id, "choice", "CHOICE_WINNER_MISMATCH") as ChoiceSignal;
  }
  const confidence = answer.confidence;
  if (!isProbability(confidence)) {
    return invalid(id, "choice", "CHOICE_CONFIDENCE_INVALID") as ChoiceSignal;
  }
  return {
    id,
    kind: "choice",
    status: "valid",
    questionVersion: "1",
    selected,
    probabilities,
    confidence,
    margin: marginOf(probabilities),
  };
}

function validateNoul(id: string, answer: unknown): NoulSignal {
  if (!isRecord(answer) || answer.type !== "noul" || !isProbability(answer.noul)) {
    return invalid(id, "noul", "NOUL_VALUE_INVALID") as NoulSignal;
  }
  return {
    id,
    kind: "noul",
    status: "valid",
    questionVersion: "1",
    probabilityTrue: answer.noul,
  };
}

function validateScore(id: string, question: ScoreQuestion, answer: unknown): ScoreSignal {
  if (!isRecord(answer) || answer.type !== "score") {
    return invalid(id, "score", "SCORE_SHAPE_INVALID") as ScoreSignal;
  }
  const maxScore = question.criteria.length - 1;
  if (
    typeof answer.score !== "number" ||
    !Number.isFinite(answer.score) ||
    answer.score < 0 ||
    answer.score > maxScore ||
    !isProbability(answer.confidence)
  ) {
    return invalid(id, "score", "SCORE_VALUE_INVALID") as ScoreSignal;
  }
  let probabilities: Record<string, number> | undefined;
  if (answer.probabilities !== undefined) {
    const keys = question.criteria.map((_, index) => String(index));
    probabilities = validateDistribution(answer.probabilities, keys);
    if (!probabilities) return invalid(id, "score", "SCORE_DISTRIBUTION_INVALID") as ScoreSignal;
    const expected = keys.reduce(
      (total, key) => total + Number(key) * (probabilities?.[key] ?? 0),
      0,
    );
    if (Math.abs(expected - answer.score) > SCORE_MEAN_TOLERANCE) {
      return invalid(id, "score", "SCORE_MEAN_MISMATCH") as ScoreSignal;
    }
  }
  return {
    id,
    kind: "score",
    status: "valid",
    questionVersion: "1",
    score: answer.score,
    confidence: answer.confidence,
    ...(probabilities ? { probabilities } : {}),
  };
}

export function validateAnswer(
  id: string,
  question: PrimitiveQuestion,
  answer: unknown,
): DecisionSignal {
  switch (question.type) {
    case "choice":
      return validateChoice(id, question, answer);
    case "noul":
      return validateNoul(id, answer);
    case "score":
      return validateScore(id, question, answer);
  }
}

export function validateAnswers(
  questions: Record<string, PrimitiveQuestion>,
  answers: Record<string, unknown>,
): DecisionSignal[] {
  return Object.entries(questions).map(([id, question]) =>
    validateAnswer(id, question, answers[id]),
  );
}
