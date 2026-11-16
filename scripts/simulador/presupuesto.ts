/** Tope de gasto del simulador. Precios de GPT-4o mini (USD por millón de tokens). */
export const PRICE_PER_MTOK = { input: 0.15, output: 0.6 } as const;

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export class Budget {
  inputTokens = 0;
  outputTokens = 0;
  calls = 0;
  readonly limitUsd: number;

  constructor(limitUsd: number) {
    if (!Number.isFinite(limitUsd) || limitUsd <= 0) throw new Error("El presupuesto tiene que ser un número positivo");
    this.limitUsd = limitUsd;
  }

  add(usage: Usage | undefined): void {
    this.calls += 1;
    this.inputTokens += Math.max(0, Number(usage?.prompt_tokens ?? 0) || 0);
    this.outputTokens += Math.max(0, Number(usage?.completion_tokens ?? 0) || 0);
  }

  get costUsd(): number {
    return (this.inputTokens * PRICE_PER_MTOK.input + this.outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
  }

  get exceeded(): boolean {
    return this.costUsd >= this.limitUsd;
  }

  /** Corta antes de empezar una conversación si no queda margen para una entera (estimado). */
  canAfford(estimatedUsd: number): boolean {
    return this.costUsd + estimatedUsd <= this.limitUsd;
  }
}

/** Costo medio por conversación ya gastado (para estimar la próxima); 0.02 USD antes de la primera. */
export function estimatePerConversation(budget: Budget, done: number): number {
  return done > 0 ? budget.costUsd / done : 0.02;
}
