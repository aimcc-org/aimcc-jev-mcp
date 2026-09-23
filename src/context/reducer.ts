import type { Evidence } from "../core/types.js";

export interface ReducedEvidence {
  evidence: Evidence[];
  truncated: boolean;
  originalChars: number;
  retainedChars: number;
}

export interface EvidenceBudget {
  maxTotalChars: number;
  maxItemChars: number;
}

export const DEFAULT_EVIDENCE_BUDGET: EvidenceBudget = {
  // 约 24k token 的保守软预算；字符数只是 Provider 无关的近似值。
  maxTotalChars: 96_000,
  maxItemChars: 24_000,
};

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function reduceEvidence(
  items: Evidence[],
  budget: EvidenceBudget = DEFAULT_EVIDENCE_BUDGET,
): ReducedEvidence {
  if (budget.maxTotalChars <= 0 || budget.maxItemChars <= 0) {
    throw new Error("Evidence budget 必须大于 0。 ");
  }
  let remaining = budget.maxTotalChars;
  let truncated = false;
  let originalChars = 0;
  let retainedChars = 0;
  const evidence: Evidence[] = [];

  for (const item of items) {
    const normalized = normalizeText(item.text);
    originalChars += normalized.length;
    if (remaining <= 0) {
      truncated = true;
      continue;
    }
    const allowed = Math.min(budget.maxItemChars, remaining);
    const wasTruncated = normalized.length > allowed;
    const marker = "\n[内容已截断]";
    if (wasTruncated && allowed <= marker.length) {
      truncated = true;
      continue;
    }
    const text = wasTruncated
      ? `${normalized.slice(0, allowed - marker.length)}${marker}`
      : normalized;
    truncated ||= wasTruncated;
    retainedChars += text.length;
    remaining -= text.length;
    evidence.push({ ...item, text });
  }

  return { evidence, truncated, originalChars, retainedChars };
}
