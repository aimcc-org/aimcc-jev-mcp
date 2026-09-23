import type { SystemOneRequest, SystemOneResponse } from "../core/types.js";

export interface SystemOneProvider {
  evaluate(request: SystemOneRequest, options?: { signal?: AbortSignal }): Promise<SystemOneResponse>;
}
