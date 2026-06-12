export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      global_config: {
        Row: {
          id: string
          cancellation_time_limit_minutes: number
          google_maps_review_link: string | null
          cost_per_km: number
          point_value: number
          updated_at: string
        }
      }
      clients: {
        Row: {
          id: string
          user_id: string
          phone: string | null
          email: string | null
          full_name: string | null
          points_balance: number
          created_at: string
        }
      }
      products: {
        Row: {
          id: string
          name: string
          description: string | null
          price: number
          image_url: string | null
          is_active: boolean
          created_at: string
        }
      }
      orders: {
        Row: {
          id: string
          client_id: string
          status: 'pending' | 'preparing' | 'delivering' | 'delivered' | 'cancelled'
          total: number
          delivery_address: string
          delivery_lat: number | null
          delivery_lng: number | null
          created_at: string
          delivered_at: string | null
        }
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
      }
      points_ledger: {
        Row: {
          id: string
          client_id: string
          order_id: string | null
          points_change: number
          reason: string
          created_at: string
        }
      }
      reviews: {
        Row: {
          id: string
          order_id: string
          client_id: string
          rating: number
          comment: string | null
          ticket_generated: boolean
          created_at: string
        }
      }
    }
  }
}
