export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type OrderStatus = 'Recibidos' | 'En Preparación' | 'En Camino' | 'Finalizados' | 'Cancelado'
export type ClientTier  = 'Bronce' | 'Plata' | 'Oro' | 'Platino'
export type PaymentMethod = 'Efectivo' | 'Tarjeta' | 'Mercado Pago'
export type OrderChannel = 'web' | 'whatsapp' | 'mostrador' | 'fudo'
export type FudoSyncStatus = 'pending' | 'sent' | 'failed' | 'skipped'
export type PaymentIntentStatus = 'pending' | 'approved' | 'cancelled' | 'expired' | 'refunded'

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string
          user_id: string | null
          name: string
          phone: string | null
          address: string | null
          tier: ClientTier
          total_points: number
          /** Saldo a favor en pesos (migración 0024). Lo mueve el trigger de credit_ledger; no se escribe a mano. */
          credit?: number
          wa_marketing_opt_in: boolean
          /** Baja de comunicaciones (migración 0021): con fecha, no recibe promociones ni encuestas. Solo la escribe el servidor. */
          unsubscribed_at?: string | null
          channel: string | null
          is_anonymous: boolean
          fudo_customer_id: number | null
          email: string | null
          source: 'app' | 'fudo'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          phone?: string | null
          address?: string | null
          tier?: ClientTier
          total_points?: number
          wa_marketing_opt_in?: boolean
          channel?: string | null
          is_anonymous?: boolean
          fudo_customer_id?: number | null
          email?: string | null
          source?: 'app' | 'fudo'
        }
        Update: {
          name?: string
          phone?: string | null
          address?: string | null
          tier?: ClientTier
          total_points?: number
          wa_marketing_opt_in?: boolean
          channel?: string | null
          is_anonymous?: boolean
          fudo_customer_id?: number | null
          email?: string | null
          source?: 'app' | 'fudo'
        }
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          client_id: string | null
          status: OrderStatus
          items_desc: string
          total: number
          delivery_fee: number
          delivery_address: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          payment_method: PaymentMethod | null
          notes: string | null
          courier_name: string | null
          accepted_at: string | null
          ready_at: string | null
          picked_up_at: string | null
          delivered_at: string | null
          survey_sent_at: string | null
          channel: OrderChannel
          points_earned: number | null
          /** Saldo a favor usado en el pedido, en pesos (migración 0024); ya está descontado de `total`. */
          credit_applied?: number
          fudo_order_id: number | null
          fudo_sync_status: FudoSyncStatus | null
          fudo_sale_type: 'DELIVERY' | 'TAKEAWAY' | 'EAT-IN' | null
          fudo_sale_state: string | null
          fudo_error: string | null
          fudo_attempts: number
          fudo_synced_at: string | null
          delivered_lat: number | null
          delivered_lng: number | null
          delivered_accuracy_m: number | null
          delivered_in_app: boolean
          geocode_attempts: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id?: string | null
          status?: OrderStatus
          items_desc: string
          total: number
          delivery_fee?: number
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          payment_method?: PaymentMethod | null
          notes?: string | null
          courier_name?: string | null
          channel?: OrderChannel
          points_earned?: number | null
          credit_applied?: number
          fudo_sync_status?: FudoSyncStatus | null
          fudo_sale_type?: 'DELIVERY' | 'TAKEAWAY' | 'EAT-IN' | null
          fudo_sale_state?: string | null
        }
        Update: {
          status?: OrderStatus
          items_desc?: string
          total?: number
          delivery_fee?: number
          delivery_address?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          payment_method?: PaymentMethod | null
          notes?: string | null
          courier_name?: string | null
          accepted_at?: string | null
          ready_at?: string | null
          picked_up_at?: string | null
          delivered_at?: string | null
          survey_sent_at?: string | null
          points_earned?: number | null
          fudo_order_id?: number | null
          fudo_sync_status?: FudoSyncStatus | null
          fudo_sale_type?: 'DELIVERY' | 'TAKEAWAY' | 'EAT-IN' | null
          fudo_sale_state?: string | null
          fudo_error?: string | null
          fudo_attempts?: number
          fudo_synced_at?: string | null
          delivered_lat?: number | null
          delivered_lng?: number | null
          delivered_accuracy_m?: number | null
          delivered_in_app?: boolean
          geocode_attempts?: number
        }
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          name: string
          qty: number
          unit_price: number
          fudo_product_id: number | null
          fudo_comment: string | null
          fudo_options: Array<{ qty: number; name: string; product_id?: string | null; fudo_product_id?: number | null; group_fudo_id?: number | null; option_fudo_id?: number | null; price?: number | null }> | null
          is_combo: boolean
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          product_id?: string | null
          name: string
          qty: number
          unit_price: number
          fudo_product_id?: number | null
          fudo_comment?: string | null
          fudo_options?: Array<{ qty: number; name: string; product_id?: string | null; fudo_product_id?: number | null; group_fudo_id?: number | null; option_fudo_id?: number | null; price?: number | null }> | null
          is_combo?: boolean
        }
        Update: Record<string, never>
        Relationships: []
      }
      couriers: {
        Row: {
          user_id: string
          name: string
          pin_hash: string
          pin_encrypted: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          name: string
          pin_hash: string
          pin_encrypted?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          pin_hash?: string
          pin_encrypted?: string | null
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      courier_shifts: {
        Row: {
          id: string
          user_id: string
          courier_name: string
          shift_day: string
          status: string
          requested_at: string
          decided_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          courier_name: string
          shift_day: string
          status?: string
          requested_at?: string
          decided_at?: string | null
        }
        Update: {
          courier_name?: string
          status?: string
          decided_at?: string | null
        }
        Relationships: []
      }
      courier_locations: {
        Row: {
          user_id: string
          courier_name: string
          lat: number
          lng: number
          accuracy_m: number | null
          heading: number | null
          speed_mps: number | null
          updated_at: string
        }
        Insert: {
          user_id: string
          courier_name: string
          lat: number
          lng: number
          accuracy_m?: number | null
          heading?: number | null
          speed_mps?: number | null
          updated_at?: string
        }
        Update: {
          courier_name?: string
          lat?: number
          lng?: number
          accuracy_m?: number | null
          heading?: number | null
          speed_mps?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      fudo_product_map: {
        Row: { product_id: string; fudo_product_id: number; fudo_name: string | null; updated_at: string }
        Insert: { product_id: string; fudo_product_id: number; fudo_name?: string | null; updated_at?: string }
        Update: { fudo_product_id?: number; fudo_name?: string | null }
        Relationships: []
      }
      fudo_payment_map: {
        Row: { payment_method: string; fudo_payment_method_id: number; updated_at: string }
        Insert: { payment_method: string; fudo_payment_method_id: number; updated_at?: string }
        Update: { fudo_payment_method_id?: number }
        Relationships: []
      }
      fudo_modifier_groups: {
        Row: { fudo_id: number; name: string; min_qty: number | null; max_qty: number | null; required: number; kind: string | null }
        Insert: { fudo_id: number; name: string; min_qty?: number | null; max_qty?: number | null; required?: number; kind?: string | null }
        Update: { name?: string; min_qty?: number | null; max_qty?: number | null; required?: number; kind?: string | null }
        Relationships: []
      }
      fudo_modifier_options: {
        Row: { fudo_id: number; group_fudo_id: number; product_fudo_id: number; name: string; price_cents: number; position: number; is_active: boolean | number }
        Insert: { fudo_id: number; group_fudo_id: number; product_fudo_id: number; name: string; price_cents?: number; position?: number; is_active?: boolean | number }
        Update: { name?: string; price_cents?: number; position?: number; is_active?: boolean | number }
        Relationships: []
      }
      fudo_product_groups: {
        Row: { product_fudo_id: number; group_fudo_id: number }
        Insert: { product_fudo_id: number; group_fudo_id: number }
        Update: { group_fudo_id?: number }
        Relationships: []
      }
      wa_campaigns: {
        Row: {
          id: string
          name: string
          segment: Json
          message: string
          status: 'sending' | 'done' | 'failed'
          recipients: number
          sent: number
          failed: number
          created_at: string
          finished_at: string | null
        }
        Insert: {
          id?: string
          name: string
          segment: Json
          message: string
          status?: 'sending' | 'done' | 'failed'
          recipients?: number
          sent?: number
          failed?: number
        }
        Update: {
          status?: 'sending' | 'done' | 'failed'
          sent?: number
          failed?: number
          finished_at?: string | null
        }
        Relationships: []
      }
      integration_secrets: {
        Row: { key: string; value: string; updated_at: string }
        Insert: { key: string; value: string }
        Update: { value?: string }
        Relationships: []
      }
      wa_conversations: {
        Row: {
          id: string
          client_phone: string
          client_id: string | null
          contact_name: string | null
          state: Json
          human_takeover: boolean
          /** Pausa temporal del bot por eco de la app WhatsApp Business (migración 021). */
          bot_paused_until?: string | null
          last_inbound_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_phone: string
          client_id?: string | null
          contact_name?: string | null
          state?: Json
          human_takeover?: boolean
          last_inbound_at?: string | null
        }
        Update: {
          client_id?: string | null
          contact_name?: string | null
          state?: Json
          human_takeover?: boolean
          bot_paused_until?: string | null
          last_inbound_at?: string | null
        }
        Relationships: []
      }
      wa_messages: {
        Row: {
          id: string
          conversation_id: string
          wamid: string | null
          direction: 'in' | 'out'
          type: string
          body: string | null
          status: string | null
          tokens: number | null
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          wamid?: string | null
          direction: 'in' | 'out'
          type: string
          body?: string | null
          status?: string | null
          tokens?: number | null
        }
        Update: {
          status?: string | null
          body?: string | null
        }
        Relationships: []
      }
      delivery_zones: {
        Row: {
          id: string
          name: string
          shape: Json
          fee: number
          min_order: number
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          shape: Json
          fee?: number
          min_order?: number
          sort_order?: number
          is_active?: boolean
        }
        Update: {
          name?: string
          shape?: Json
          fee?: number
          min_order?: number
          sort_order?: number
          is_active?: boolean
        }
        Relationships: []
      }
      order_events: {
        Row: {
          id: string
          order_id: string
          event: string
          actor: string | null
          detail: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          event: string
          actor?: string | null
          detail?: string | null
        }
        Update: Record<string, never>
        Relationships: []
      }
      points_ledger: {
        Row: {
          id: string
          client_id: string
          order_id: string | null
          delta: number
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          order_id?: string | null
          delta: number
          description: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      credit_ledger: {
        Row: {
          id: string
          client_id: string
          order_id: string | null
          reclamo_id: string | null
          /** Pesos: positivo acredita, negativo debita. */
          delta: number
          motivo: 'reclamo' | 'compra' | 'devolucion' | 'ajuste'
          description: string | null
          idempotency_key: string
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          order_id?: string | null
          reclamo_id?: string | null
          delta: number
          motivo: 'reclamo' | 'compra' | 'devolucion' | 'ajuste'
          description?: string | null
          idempotency_key: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          name: string
          description: string
          is_active: boolean
          points_per_100: number | null
          created_at: string
          updated_at: string
          fudo_id: number | null
          source: 'manual' | 'fudo'
          fudo_synced_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string
          is_active?: boolean
          points_per_100?: number | null
          fudo_id?: number | null
          source?: 'manual' | 'fudo'
          fudo_synced_at?: string | null
        }
        Update: {
          name?: string
          description?: string
          is_active?: boolean
          points_per_100?: number | null
          fudo_id?: number | null
          source?: 'manual' | 'fudo'
          fudo_synced_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          id: string
          category_id: string | null
          name: string
          description: string
          price: number
          image_url: string
          is_active: boolean
          /** Solo en D1 (migración 0009). Supabase no la tiene: ausente = visible. */
          show_in_portal?: boolean
          points_per_100: number | null
          created_at: string
          updated_at: string
          fudo_id: number | null
          source: 'manual' | 'fudo'
          fudo_synced_at: string | null
        }
        Insert: {
          id?: string
          category_id?: string | null
          name: string
          description?: string
          price: number
          image_url?: string
          is_active?: boolean
          points_per_100?: number | null
          fudo_id?: number | null
          source?: 'manual' | 'fudo'
          fudo_synced_at?: string | null
        }
        Update: {
          category_id?: string | null
          name?: string
          description?: string
          price?: number
          image_url?: string
          is_active?: boolean
          points_per_100?: number | null
          fudo_id?: number | null
          source?: 'manual' | 'fudo'
          fudo_synced_at?: string | null
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          id: string
          user_id: string
          email: string | null
          role: string | null
          document: string
          version: string
          accepted_at: string
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          id?: string
          user_id: string
          email?: string | null
          role?: string | null
          document: string
          version: string
          accepted_at?: string
          ip?: string | null
          user_agent?: string | null
        }
        Update: Record<string, never>
        Relationships: []
      }
      payment_intents: {
        Row: {
          id: string
          client_id: string
          channel: OrderChannel
          status: PaymentIntentStatus
          total: number
          snapshot: Json
          mp_preference_id: string | null
          checkout_url: string | null
          mp_payment_id: string | null
          order_id: string | null
          expires_at: string
          refund_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          channel: OrderChannel
          status?: PaymentIntentStatus
          total: number
          snapshot: Json
          mp_preference_id?: string | null
          checkout_url?: string | null
          mp_payment_id?: string | null
          order_id?: string | null
          expires_at: string
          refund_error?: string | null
        }
        Update: {
          status?: PaymentIntentStatus
          mp_preference_id?: string | null
          checkout_url?: string | null
          mp_payment_id?: string | null
          order_id?: string | null
          refund_error?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          id: string
          order_id: string
          client_id: string
          rating: number
          feedback: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          client_id: string
          rating: number
          feedback?: string | null
        }
        Update: Record<string, never>
        Relationships: []
      }
      global_config: {
        Row: {
          key: string
          value: Json
          updated_at: string
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          value?: Json
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
