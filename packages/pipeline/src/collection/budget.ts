/** Per-run resource budget. Owner: L3 (S2-L3-1). Design v3 §9 initial caps.
 * `consume` throws before the provider is called. The pipeline consumes `catalog_query` once per
 * search it issues; catalog adapters consume `fetch`/`browser_session`, model adapters `model_call`.
 */
import type { BudgetResource } from './types';

export const DEFAULT_RUN_CAPS: Readonly<Record<BudgetResource, number>> = {
  catalog_query: 12,
  fetch: 12,
  browser_session: 2,
  model_call: 6,
};

export class BudgetExhaustedError extends Error {
  readonly resource: BudgetResource;
  constructor(resource: BudgetResource) {
    super(`Run budget exhausted: ${resource}`);
    this.name = 'BudgetExhaustedError';
    this.resource = resource;
  }
}

export interface RunBudget {
  consume(resource: BudgetResource, amount: number): void;
  usage(): Record<BudgetResource, number>;
}

export function createRunBudget(caps: Partial<Record<BudgetResource, number>> = {}): RunBudget {
  const limits = { ...DEFAULT_RUN_CAPS, ...caps };
  const used: Record<BudgetResource, number> = {
    catalog_query: 0,
    fetch: 0,
    browser_session: 0,
    model_call: 0,
  };
  return {
    consume(resource, amount) {
      if (!Number.isInteger(amount) || amount < 0) throw new RangeError('Invalid budget amount');
      if (used[resource] + amount > limits[resource]) throw new BudgetExhaustedError(resource);
      used[resource] += amount;
    },
    usage: () => ({ ...used }),
  };
}
