import { KernelError, errorMessage } from "../core/errors.js";
import type {
  PrimitiveQuestion,
  SystemOneRequest,
  SystemOneResponse,
} from "../core/types.js";
import type { SystemOneProvider } from "./system-one.js";

const MAX_SEQUENCE_TOKENS = 512;
const MAX_STATE_TOKENS = 256;
const TEMPERATURE = 1.05;

interface TokenizerOutput {
  input_ids: { data: ArrayLike<number | bigint> };
}

interface TensorOutput {
  data: ArrayLike<number>;
}

interface LocalRuntime {
  tokenizer: (text: string, options: { add_special_tokens: false }) => TokenizerOutput;
  model: (inputs: Record<string, unknown>) => Promise<{ logits: { to(type: string): TensorOutput } }>;
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => unknown;
}

export interface LocalOpenJevOptions {
  modelId: string;
  repo: string;
  dtype: "q4" | "q4f16" | "fp16" | "fp32";
}

interface PreparedQuestion {
  id: string;
  question: PrimitiveQuestion;
  optionKeys: string[];
  optionTexts: string[];
}

function questionOptions(id: string, question: PrimitiveQuestion): PreparedQuestion {
  switch (question.type) {
    case "choice": {
      const entries = Object.entries(question.criteria);
      return {
        id,
        question,
        optionKeys: entries.map(([key]) => key),
        optionTexts: entries.map(([key, description]) =>
          description ? `${key}: ${description}` : key,
        ),
      };
    }
    case "noul":
      return {
        id,
        question,
        optionKeys: ["false", "true"],
        optionTexts: [
          `no: ${question.criteria.false}`,
          `yes: ${question.criteria.true}`,
        ],
      };
    case "score":
      return {
        id,
        question,
        optionKeys: question.criteria.map((_, index) => String(index)),
        optionTexts: question.criteria,
      };
  }
}

function softmax(values: number[]): number[] {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new KernelError("INVALID_PROVIDER_RESPONSE", "本地 OpenJev 返回了非法 logits。");
  }
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp((value - maximum) / TEMPERATURE));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function selectedIndex(probabilities: number[]): number {
  return probabilities.reduce(
    (best, value, index) => (value > (probabilities[best] ?? -1) ? index : best),
    0,
  );
}

async function loadRuntime(repo: string, dtype: LocalOpenJevOptions["dtype"]): Promise<LocalRuntime> {
  const module = await import("@huggingface/transformers");
  const tokenizerLoader = module.AutoTokenizer as unknown as {
    from_pretrained(name: string): Promise<unknown>;
  };
  const modelLoader = module.AutoModel as unknown as {
    from_pretrained(name: string, options: Record<string, unknown>): Promise<unknown>;
  };
  const [tokenizer, model] = await Promise.all([
    tokenizerLoader.from_pretrained(repo),
    modelLoader.from_pretrained(repo, { dtype }),
  ]);
  return {
    tokenizer: tokenizer as LocalRuntime["tokenizer"],
    model: model as LocalRuntime["model"],
    Tensor: module.Tensor as unknown as LocalRuntime["Tensor"],
  };
}

function encode(runtime: LocalRuntime, text: string): number[] {
  return Array.from(
    runtime.tokenizer(text, { add_special_tokens: false }).input_ids.data,
    Number,
  );
}

function singleMarker(runtime: LocalRuntime, marker: string): number {
  const tokens = encode(runtime, marker);
  if (tokens.length !== 1 || tokens[0] === undefined) {
    throw new KernelError(
      "INVALID_PROVIDER_RESPONSE",
      `本地 OpenJev tokenizer 未将 ${marker} 识别为单个 marker token。`,
    );
  }
  return tokens[0];
}

function stateText(state: unknown): string {
  if (typeof state === "string") return state;
  try {
    return JSON.stringify(state);
  } catch (error) {
    throw new KernelError("INVALID_PROVIDER_RESPONSE", "本地 OpenJev 无法序列化 state。", error);
  }
}

function answerFor(
  prepared: PreparedQuestion,
  probabilities: number[],
): Record<string, unknown> {
  const distribution = Object.fromEntries(
    prepared.optionKeys.map((key, index) => [key, probabilities[index] ?? 0]),
  );
  const confidence = Math.max(...probabilities);
  switch (prepared.question.type) {
    case "choice": {
      const index = selectedIndex(probabilities);
      return {
        type: "choice",
        choice: prepared.optionKeys[index],
        probabilities: distribution,
        confidence,
      };
    }
    case "noul":
      return { type: "noul", noul: probabilities[1] ?? 0 };
    case "score": {
      const score = probabilities.reduce((sum, value, index) => sum + value * index, 0);
      return { type: "score", score, probabilities: distribution, confidence };
    }
  }
}

export class LocalOpenJevProvider implements SystemOneProvider {
  private readonly runtime: Promise<LocalRuntime>;

  constructor(
    private readonly config: LocalOpenJevOptions,
    dependencies?: { runtime?: Promise<LocalRuntime>; logger?: (message: string) => void },
  ) {
    const logger = dependencies?.logger ?? ((message: string) => console.error(message));
    logger(`正在加载本地 OpenJev 模型 ${config.modelId}（${config.dtype}）...`);
    this.runtime = (dependencies?.runtime ?? loadRuntime(config.repo, config.dtype))
      .then((runtime) => {
        logger(`本地 OpenJev 模型已就绪：${config.modelId}`);
        return runtime;
      })
      .catch((error: unknown) => {
        throw new KernelError(
          "PROVIDER_ERROR",
          `本地 OpenJev 模型加载失败：${errorMessage(error)}`,
          error,
        );
      });
    void this.runtime.catch(() => undefined);
  }

  async evaluate(
    request: SystemOneRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SystemOneResponse> {
    if (options?.signal?.aborted) {
      throw new KernelError("PROVIDER_ERROR", "本地 OpenJev 请求已取消。", options.signal.reason);
    }
    const runtime = await this.runtime;
    const markers = {
      cls: singleMarker(runtime, "[CLS]"),
      sep: singleMarker(runtime, "[SEP]"),
      state: singleMarker(runtime, "[STATE]"),
      question: singleMarker(runtime, "[Q]"),
      option: singleMarker(runtime, "[OPT]"),
    };
    const encodedState = encode(runtime, stateText(request.state));
    const answers: Record<string, unknown> = {};
    let inputTokens = 0;

    for (const [id, question] of Object.entries(request.questions)) {
      if (options?.signal?.aborted) {
        throw new KernelError("PROVIDER_ERROR", "本地 OpenJev 请求已取消。", options.signal.reason);
      }
      const prepared = questionOptions(id, question);
      const instructionTokens = encode(runtime, question.instructions);
      const optionTokens = prepared.optionTexts.map((text) => encode(runtime, text));
      const optionCount = optionTokens.length;
      const availableText = MAX_SEQUENCE_TOKENS - 4 - optionCount;
      if (availableText < optionCount + 2) {
        throw new KernelError(
          "PROVIDER_ERROR",
          `本地 OpenJev 无法在 512 token 内容纳问题 ${id} 的 ${optionCount} 个选项。`,
        );
      }

      let stateLimit = Math.min(MAX_STATE_TOKENS, Math.max(1, Math.floor(availableText * 0.55)));
      if (availableText - stateLimit < optionCount + 1) {
        stateLimit = availableText - optionCount - 1;
      }
      const stateTokens = encodedState.slice(0, stateLimit);
      let remaining = availableText - stateTokens.length;
      const instructionLimit = Math.max(1, Math.min(instructionTokens.length, remaining - optionCount));
      const fittedInstruction = instructionTokens.slice(0, instructionLimit);
      remaining -= fittedInstruction.length;

      const fittedOptions = optionTokens.map((tokens, index) => {
        const optionsLeft = optionCount - index;
        const limit = Math.max(1, Math.floor(remaining / optionsLeft));
        const fitted = tokens.slice(0, limit);
        remaining -= fitted.length;
        return fitted;
      });

      const tokens = [markers.cls, markers.state, ...stateTokens, markers.question];
      const seg = tokens.map(() => -1);
      tokens.push(...fittedInstruction);
      seg.push(...fittedInstruction.map(() => optionCount));
      const pairQ: number[] = [];
      const pairOpt: number[] = [];
      fittedOptions.forEach((fitted, index) => {
        tokens.push(markers.option, ...fitted);
        seg.push(-1, ...fitted.map(() => index));
        pairQ.push(optionCount);
        pairOpt.push(index);
      });
      tokens.push(markers.sep);
      seg.push(-1);
      inputTokens += tokens.length;

      const tensor = (values: number[], dims: number[]): unknown =>
        new runtime.Tensor("int64", BigInt64Array.from(values, BigInt), dims);
      const result = await runtime.model({
        input_ids: tensor(tokens, [1, tokens.length]),
        attention_mask: tensor(tokens.map(() => 1), [1, tokens.length]),
        seg: tensor(seg, [1, seg.length]),
        pair_q: tensor(pairQ, [1, pairQ.length]),
        pair_opt: tensor(pairOpt, [1, pairOpt.length]),
      });
      const logits = Array.from(result.logits.to("float32").data, Number).slice(0, optionCount);
      if (logits.length !== optionCount) {
        throw new KernelError(
          "INVALID_PROVIDER_RESPONSE",
          `本地 OpenJev 对问题 ${id} 返回了错误数量的 logits。`,
        );
      }
      answers[id] = answerFor(prepared, softmax(logits));
    }

    return {
      answers,
      usage: { inputTokens, outputTokens: 0 },
      provider: "local",
      model: this.config.modelId,
    };
  }
}
