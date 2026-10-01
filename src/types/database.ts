export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type OrderStatus = 'Recibidos' | 'En Preparación' | 'En Camino' | 'Finalizados' | 'Cancelado'
export type ClientTier  = 'Bronce' | 'Plata' | 'Oro' | 'Platino'
export type PaymentMethod = 'Efectivo' | 'Tarjeta' | 'Mercado Pago'

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
        }
        Update: {
          name?: string
          phone?: string | null
          address?: string | null
          tier?: ClientTier
          total_points?: number
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
        }
        Update: {
          status?: OrderStatus
          items_desc?: string
          total?: number
          courier_name?: string | null
        }
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
      categories: {
        Row: {
          id: string
          name: string
          description: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string
          is_active?: boolean
        }
        Update: {
          name?: string
          description?: string
          is_active?: boolean
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
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          category_id?: string | null
          name: string
          description?: string
          price: number
          image_url?: string
          is_active?: boolean
        }
        Update: {
          category_id?: string | null
          name?: string
          description?: string
          price?: number
          image_url?: string
          is_active?: boolean
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
