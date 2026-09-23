import { KernelError, errorMessage } from "../core/errors.js";

export interface HttpTransportOptions {
  timeoutMs: number;
  maxAttempts: number;
  maxResponseBytes: number;
}

interface Deadline {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

function createDeadline(signal: AbortSignal | undefined, timeoutMs: number): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("请求超时"));
  }, timeoutMs);
  const relay = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) relay();
  else signal?.addEventListener("abort", relay, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relay);
    },
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

function retryDelay(attempt: number): number {
  const maximum = Math.min(500 * 2 ** (attempt - 1), 4_000);
  return maximum * (0.5 + Math.random() * 0.5);
}

async function waitForRetry(attempt: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, retryDelay(attempt));
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBounded(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        throw new KernelError(
          "RESPONSE_TOO_LARGE",
          `Provider 响应超过 ${maximum} 字节上限，已停止读取。`,
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[已隐藏]") : text;
}

export async function postJson(
  url: string,
  init: {
    headers: Record<string, string>;
    body: unknown;
    secret: string;
    providerLabel: string;
  },
  transport: HttpTransportOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new KernelError("CONFIGURATION_ERROR", `Provider URL 无效：${url}`, error);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new KernelError("CONFIGURATION_ERROR", "Provider URL 仅支持 HTTP 或 HTTPS。 ");
  }

  const deadline = createDeadline(signal, transport.timeoutMs);
  try {
    for (let attempt = 1; attempt <= transport.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(parsedUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...init.headers },
          body: JSON.stringify(init.body),
          signal: deadline.signal,
        });
      } catch (error) {
        if (deadline.timedOut()) {
          throw new KernelError(
            "PROVIDER_TIMEOUT",
            `${init.providerLabel} 请求超过 ${transport.timeoutMs}ms 截止时间。`,
            error,
          );
        }
        throw new KernelError(
          "PROVIDER_ERROR",
          `${init.providerLabel} 网络请求失败：${redact(errorMessage(error), init.secret)}`,
          error,
        );
      }

      if (isRetryableStatus(response.status) && attempt < transport.maxAttempts) {
        await response.body?.cancel().catch(() => undefined);
        try {
          await waitForRetry(attempt, deadline.signal);
        } catch (error) {
          if (deadline.timedOut()) {
            throw new KernelError(
              "PROVIDER_TIMEOUT",
              `${init.providerLabel} 请求超过 ${transport.timeoutMs}ms 截止时间。`,
              error,
            );
          }
          throw new KernelError("PROVIDER_ERROR", `${init.providerLabel} 请求已取消。`, error);
        }
        continue;
      }

      const text = await readBounded(response, transport.maxResponseBytes, deadline.signal);
      if (!response.ok) {
        throw new KernelError(
          "PROVIDER_ERROR",
          `${init.providerLabel} 返回 HTTP ${response.status}：${redact(text, init.secret).slice(0, 300)}`,
        );
      }
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new KernelError(
          "INVALID_PROVIDER_RESPONSE",
          `${init.providerLabel} 未返回合法 JSON。`,
          error,
        );
      }
    }
    throw new KernelError("PROVIDER_ERROR", `${init.providerLabel} 请求未完成。`);
  } finally {
    deadline.dispose();
  }
}
