export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type OrderStatus = 'Recibidos' | 'En Preparación' | 'En Camino' | 'Finalizados' | 'Cancelado'
export type ClientTier  = 'Bronce' | 'Plata' | 'Oro' | 'Platino'

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
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id?: string | null
          status?: OrderStatus
          items_desc: string
          total: number
        }
        Update: {
          status?: OrderStatus
          items_desc?: string
          total?: number
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
