import { isDemoMode } from "@/lib/demo/mode";
import { buildPreference, type MpPayment } from "./mercadopago.ts";
import { checkoutUrl, createPreference, getPayment, readMpConfig, refundPayment, searchPaymentsByReference, type FetchLike, type MpConfig } from "./mp-api.ts";

/** Lo que el negocio necesita de un procesador de pagos. Hoy: Mercado Pago real o el simulador del modo demo. */
export interface PaymentGateway {
  readonly name: "mercadopago" | "demo";
  createCheckout(input: CheckoutInput): Promise<{ preferenceId: string | null; url: string }>;
  fetchPayment(paymentId: string): Promise<MpPayment>;
  findPayments(intentId: string): Promise<MpPayment[]>;
  refund(paymentId: string, idempotencyKey: string): Promise<void>;
}

export interface CheckoutInput {
  intentId: string;
  title: string;
  total: number;
  payerEmail?: string | null;
  expiresAt: Date;
}

export function mercadoPagoGateway(cfg: MpConfig, fetchImpl?: FetchLike): PaymentGateway {
  return {
    name: "mercadopago",
    async createCheckout(input) {
      const base = cfg.baseUrl.replace(/\/$/, "");
      const body = buildPreference({ ...input, baseUrl: base, notificationUrl: `${base}/api/payments/mercadopago/webhook` });
      const preference = await createPreference(cfg, body, `pref-${input.intentId}`, fetchImpl);
      return { preferenceId: preference.id, url: checkoutUrl(cfg, preference) };
    },
    fetchPayment: (paymentId) => getPayment(cfg, paymentId, fetchImpl),
    findPayments: (intentId) => searchPaymentsByReference(cfg, intentId, fetchImpl),
    async refund(paymentId, idempotencyKey) {
      await refundPayment(cfg, paymentId, idempotencyKey, fetchImpl);
    },
  };
}

/** Simulador del modo demo: no sale a la red. El "pago" se resuelve desde /demo/mercadopago/<intención>. */
export function demoGateway(): PaymentGateway {
  return {
    name: "demo",
    createCheckout: async (input) => ({ preferenceId: `demo-pref-${input.intentId}`, url: `/demo/mercadopago/${input.intentId}` }),
    fetchPayment: async () => {
      throw new Error("El simulador no consulta pagos.");
    },
    findPayments: async () => [],
    refund: async () => undefined,
  };
}

/** El procesador disponible, o null si el cobro digital no está configurado. */
export function getGateway(): PaymentGateway | null {
  if (isDemoMode()) return demoGateway();
  const cfg = readMpConfig();
  return cfg ? mercadoPagoGateway(cfg) : null;
}

export const isOnlinePaymentEnabled = (): boolean => getGateway() !== null;
