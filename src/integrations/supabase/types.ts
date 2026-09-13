export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bot_sessions: {
        Row: {
          created_at: string
          error_count: number
          id: string
          losing_trades: number
          max_drawdown: number
          mode: Database["public"]["Enums"]["strategy_mode"]
          realized_pnl: number
          started_at: string
          status: Database["public"]["Enums"]["bot_state"]
          stopped_at: string | null
          strategy_id: string | null
          trades_count: number
          updated_at: string
          user_id: string
          winning_trades: number
        }
        Insert: {
          created_at?: string
          error_count?: number
          id?: string
          losing_trades?: number
          max_drawdown?: number
          mode?: Database["public"]["Enums"]["strategy_mode"]
          realized_pnl?: number
          started_at?: string
          status?: Database["public"]["Enums"]["bot_state"]
          stopped_at?: string | null
          strategy_id?: string | null
          trades_count?: number
          updated_at?: string
          user_id: string
          winning_trades?: number
        }
        Update: {
          created_at?: string
          error_count?: number
          id?: string
          losing_trades?: number
          max_drawdown?: number
          mode?: Database["public"]["Enums"]["strategy_mode"]
          realized_pnl?: number
          started_at?: string
          status?: Database["public"]["Enums"]["bot_state"]
          stopped_at?: string | null
          strategy_id?: string | null
          trades_count?: number
          updated_at?: string
          user_id?: string
          winning_trades?: number
        }
        Relationships: [
          {
            foreignKeyName: "bot_sessions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_status: {
        Row: {
          created_at: string
          id: string
          killed_at: string | null
          last_error: string | null
          mode: Database["public"]["Enums"]["strategy_mode"]
          session_id: string | null
          state: Database["public"]["Enums"]["bot_state"]
          state_changed_at: string
          strategy_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          killed_at?: string | null
          last_error?: string | null
          mode?: Database["public"]["Enums"]["strategy_mode"]
          session_id?: string | null
          state?: Database["public"]["Enums"]["bot_state"]
          state_changed_at?: string
          strategy_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          killed_at?: string | null
          last_error?: string | null
          mode?: Database["public"]["Enums"]["strategy_mode"]
          session_id?: string | null
          state?: Database["public"]["Enums"]["bot_state"]
          state_changed_at?: string
          strategy_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_status_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bot_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_status_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      job_leases: {
        Row: {
          holder: string | null
          job_name: string
          last_result: Json | null
          last_run_at: string | null
          locked_until: string
          updated_at: string
        }
        Insert: {
          holder?: string | null
          job_name: string
          last_result?: Json | null
          last_run_at?: string | null
          locked_until: string
          updated_at?: string
        }
        Update: {
          holder?: string | null
          job_name?: string
          last_result?: Json | null
          last_run_at?: string | null
          locked_until?: string
          updated_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          created_at: string
          executed_at: string | null
          executed_price: number | null
          execution_provider: Database["public"]["Enums"]["execution_provider"]
          external_order_id: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          order_type: Database["public"]["Enums"]["order_type"]
          position_id: string | null
          quantity: number | null
          requested_price: number | null
          risk_snapshot: Json | null
          side: Database["public"]["Enums"]["order_side"]
          slippage: number | null
          status: Database["public"]["Enums"]["order_status"]
          strategy_id: string | null
          submitted_at: string | null
          token_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          executed_at?: string | null
          executed_price?: number | null
          execution_provider?: Database["public"]["Enums"]["execution_provider"]
          external_order_id?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          order_type?: Database["public"]["Enums"]["order_type"]
          position_id?: string | null
          quantity?: number | null
          requested_price?: number | null
          risk_snapshot?: Json | null
          side: Database["public"]["Enums"]["order_side"]
          slippage?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          strategy_id?: string | null
          submitted_at?: string | null
          token_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          executed_at?: string | null
          executed_price?: number | null
          execution_provider?: Database["public"]["Enums"]["execution_provider"]
          external_order_id?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          order_type?: Database["public"]["Enums"]["order_type"]
          position_id?: string | null
          quantity?: number | null
          requested_price?: number | null
          risk_snapshot?: Json | null
          side?: Database["public"]["Enums"]["order_side"]
          slippage?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          strategy_id?: string | null
          submitted_at?: string | null
          token_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_snapshots: {
        Row: {
          available_balance: number | null
          id: string
          invested_amount: number | null
          open_positions: number | null
          realized_pnl: number | null
          session_id: string | null
          timestamp: string
          total_balance: number | null
          total_exposure: number | null
          unrealized_pnl: number | null
          user_id: string
        }
        Insert: {
          available_balance?: number | null
          id?: string
          invested_amount?: number | null
          open_positions?: number | null
          realized_pnl?: number | null
          session_id?: string | null
          timestamp?: string
          total_balance?: number | null
          total_exposure?: number | null
          unrealized_pnl?: number | null
          user_id: string
        }
        Update: {
          available_balance?: number | null
          id?: string
          invested_amount?: number | null
          open_positions?: number | null
          realized_pnl?: number | null
          session_id?: string | null
          timestamp?: string
          total_balance?: number | null
          total_exposure?: number | null
          unrealized_pnl?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_snapshots_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bot_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          close_reason: string | null
          closed_at: string | null
          created_at: string
          current_price: number | null
          current_value: number | null
          entry_price: number | null
          execution_provider: Database["public"]["Enums"]["execution_provider"]
          external_position_id: string | null
          id: string
          invested_amount: number | null
          opened_at: string
          quantity: number | null
          side: Database["public"]["Enums"]["position_side"]
          status: Database["public"]["Enums"]["position_status"]
          stop_loss_price: number | null
          strategy_id: string | null
          take_profit_price: number | null
          token_id: string | null
          trailing_stop_price: number | null
          unrealized_pnl: number | null
          unrealized_pnl_percent: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_price?: number | null
          current_value?: number | null
          entry_price?: number | null
          execution_provider?: Database["public"]["Enums"]["execution_provider"]
          external_position_id?: string | null
          id?: string
          invested_amount?: number | null
          opened_at?: string
          quantity?: number | null
          side?: Database["public"]["Enums"]["position_side"]
          status?: Database["public"]["Enums"]["position_status"]
          stop_loss_price?: number | null
          strategy_id?: string | null
          take_profit_price?: number | null
          token_id?: string | null
          trailing_stop_price?: number | null
          unrealized_pnl?: number | null
          unrealized_pnl_percent?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          current_price?: number | null
          current_value?: number | null
          entry_price?: number | null
          execution_provider?: Database["public"]["Enums"]["execution_provider"]
          external_position_id?: string | null
          id?: string
          invested_amount?: number | null
          opened_at?: string
          quantity?: number | null
          side?: Database["public"]["Enums"]["position_side"]
          status?: Database["public"]["Enums"]["position_status"]
          stop_loss_price?: number | null
          strategy_id?: string | null
          take_profit_price?: number | null
          token_id?: string | null
          trailing_stop_price?: number | null
          unrealized_pnl?: number | null
          unrealized_pnl_percent?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_integrations: {
        Row: {
          capabilities: Json
          consecutive_failures: number
          last_error: string | null
          last_error_at: string | null
          last_success_at: string | null
          latency_ms: number | null
          paused_until: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          consecutive_failures?: number
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          latency_ms?: number | null
          paused_until?: string | null
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          consecutive_failures?: number
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          latency_ms?: number | null
          paused_until?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      risk_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["risk_event_type"]
          id: string
          message: string
          metadata: Json
          order_id: string | null
          severity: Database["public"]["Enums"]["risk_severity"]
          strategy_id: string | null
          token_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["risk_event_type"]
          id?: string
          message: string
          metadata?: Json
          order_id?: string | null
          severity?: Database["public"]["Enums"]["risk_severity"]
          strategy_id?: string | null
          token_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["risk_event_type"]
          id?: string
          message?: string
          metadata?: Json
          order_id?: string | null
          severity?: Database["public"]["Enums"]["risk_severity"]
          strategy_id?: string | null
          token_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_events_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_events_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_settings: {
        Row: {
          consecutive_loss_limit: number
          created_at: string
          id: string
          kill_switch: boolean
          max_daily_loss: number
          max_exposure: number
          max_positions: number
          max_slippage: number
          max_trade_loss: number
          updated_at: string
          user_id: string
        }
        Insert: {
          consecutive_loss_limit?: number
          created_at?: string
          id?: string
          kill_switch?: boolean
          max_daily_loss?: number
          max_exposure?: number
          max_positions?: number
          max_slippage?: number
          max_trade_loss?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          consecutive_loss_limit?: number
          created_at?: string
          id?: string
          kill_switch?: boolean
          max_daily_loss?: number
          max_exposure?: number
          max_positions?: number
          max_slippage?: number
          max_trade_loss?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      signals: {
        Row: {
          confidence: number | null
          created_at: string
          direction: Database["public"]["Enums"]["signal_direction"]
          expires_at: string | null
          hunter_score: number | null
          id: string
          metadata: Json
          provider_signal_id: string | null
          reason_codes: string[]
          signal_type: Database["public"]["Enums"]["signal_type"]
          source: Database["public"]["Enums"]["signal_source"]
          status: Database["public"]["Enums"]["signal_status"]
          token_id: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          direction?: Database["public"]["Enums"]["signal_direction"]
          expires_at?: string | null
          hunter_score?: number | null
          id?: string
          metadata?: Json
          provider_signal_id?: string | null
          reason_codes?: string[]
          signal_type: Database["public"]["Enums"]["signal_type"]
          source?: Database["public"]["Enums"]["signal_source"]
          status?: Database["public"]["Enums"]["signal_status"]
          token_id?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          direction?: Database["public"]["Enums"]["signal_direction"]
          expires_at?: string | null
          hunter_score?: number | null
          id?: string
          metadata?: Json
          provider_signal_id?: string | null
          reason_codes?: string[]
          signal_type?: Database["public"]["Enums"]["signal_type"]
          source?: Database["public"]["Enums"]["signal_source"]
          status?: Database["public"]["Enums"]["signal_status"]
          token_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      strategies: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          mode: Database["public"]["Enums"]["strategy_mode"]
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          mode?: Database["public"]["Enums"]["strategy_mode"]
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          mode?: Database["public"]["Enums"]["strategy_mode"]
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      strategy_parameters: {
        Row: {
          allow_momentum: boolean
          allow_new_launches: boolean
          allow_smart_money: boolean
          created_at: string
          hunter_score_min: number
          id: string
          max_exposure: number
          max_positions: number
          max_slippage: number
          max_token_age: number
          min_liquidity: number
          min_token_age: number
          min_volume: number
          partial_take_profit_amount: number
          partial_take_profit_enabled: boolean
          partial_take_profit_percent: number
          position_size: number
          score_weights: Json
          smart_money_score_min: number
          stop_loss_percent: number
          strategy_id: string
          take_profit_multiplier: number
          trailing_stop_enabled: boolean
          trailing_stop_percent: number
          updated_at: string
        }
        Insert: {
          allow_momentum?: boolean
          allow_new_launches?: boolean
          allow_smart_money?: boolean
          created_at?: string
          hunter_score_min?: number
          id?: string
          max_exposure?: number
          max_positions?: number
          max_slippage?: number
          max_token_age?: number
          min_liquidity?: number
          min_token_age?: number
          min_volume?: number
          partial_take_profit_amount?: number
          partial_take_profit_enabled?: boolean
          partial_take_profit_percent?: number
          position_size?: number
          score_weights?: Json
          smart_money_score_min?: number
          stop_loss_percent?: number
          strategy_id: string
          take_profit_multiplier?: number
          trailing_stop_enabled?: boolean
          trailing_stop_percent?: number
          updated_at?: string
        }
        Update: {
          allow_momentum?: boolean
          allow_new_launches?: boolean
          allow_smart_money?: boolean
          created_at?: string
          hunter_score_min?: number
          id?: string
          max_exposure?: number
          max_positions?: number
          max_slippage?: number
          max_token_age?: number
          min_liquidity?: number
          min_token_age?: number
          min_volume?: number
          partial_take_profit_amount?: number
          partial_take_profit_enabled?: boolean
          partial_take_profit_percent?: number
          position_size?: number
          score_weights?: Json
          smart_money_score_min?: number
          stop_loss_percent?: number
          strategy_id?: string
          take_profit_multiplier?: number
          trailing_stop_enabled?: boolean
          trailing_stop_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_parameters_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: true
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          component: string
          created_at: string
          event: string
          id: string
          level: Database["public"]["Enums"]["log_level"]
          message: string | null
          metadata: Json
          user_id: string | null
        }
        Insert: {
          component: string
          created_at?: string
          event: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message?: string | null
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          component?: string
          created_at?: string
          event?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message?: string | null
          metadata?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      token_relationships: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          source_token_id: string
          strength: number
          target_token_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          source_token_id: string
          strength?: number
          target_token_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          relationship_type?: Database["public"]["Enums"]["relationship_type"]
          source_token_id?: string
          strength?: number
          target_token_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_relationships_source_token_id_fkey"
            columns: ["source_token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "token_relationships_target_token_id_fkey"
            columns: ["target_token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          address: string
          buy_sell_ratio: number | null
          buys_5m: number | null
          chain: string
          created_at: string
          data_source: string | null
          decimals: number | null
          holders: number | null
          hunter_score: number | null
          id: string
          is_blacklisted: boolean
          is_new: boolean
          is_verified: boolean
          last_market_update: string | null
          last_smart_money_update: string | null
          liquidity: number | null
          logo_url: string | null
          market_cap: number | null
          momentum_score: number | null
          name: string | null
          price: number | null
          price_change_1h: number | null
          price_change_24h: number | null
          price_change_5m: number | null
          sells_5m: number | null
          smart_money_score: number | null
          social_score: number | null
          symbol: string | null
          token_age_seconds: number | null
          top_holder_percentage: number | null
          updated_at: string
          volume_1h: number | null
          volume_24h: number | null
          volume_5m: number | null
        }
        Insert: {
          address: string
          buy_sell_ratio?: number | null
          buys_5m?: number | null
          chain?: string
          created_at?: string
          data_source?: string | null
          decimals?: number | null
          holders?: number | null
          hunter_score?: number | null
          id?: string
          is_blacklisted?: boolean
          is_new?: boolean
          is_verified?: boolean
          last_market_update?: string | null
          last_smart_money_update?: string | null
          liquidity?: number | null
          logo_url?: string | null
          market_cap?: number | null
          momentum_score?: number | null
          name?: string | null
          price?: number | null
          price_change_1h?: number | null
          price_change_24h?: number | null
          price_change_5m?: number | null
          sells_5m?: number | null
          smart_money_score?: number | null
          social_score?: number | null
          symbol?: string | null
          token_age_seconds?: number | null
          top_holder_percentage?: number | null
          updated_at?: string
          volume_1h?: number | null
          volume_24h?: number | null
          volume_5m?: number | null
        }
        Update: {
          address?: string
          buy_sell_ratio?: number | null
          buys_5m?: number | null
          chain?: string
          created_at?: string
          data_source?: string | null
          decimals?: number | null
          holders?: number | null
          hunter_score?: number | null
          id?: string
          is_blacklisted?: boolean
          is_new?: boolean
          is_verified?: boolean
          last_market_update?: string | null
          last_smart_money_update?: string | null
          liquidity?: number | null
          logo_url?: string | null
          market_cap?: number | null
          momentum_score?: number | null
          name?: string | null
          price?: number | null
          price_change_1h?: number | null
          price_change_24h?: number | null
          price_change_5m?: number | null
          sells_5m?: number | null
          smart_money_score?: number | null
          social_score?: number | null
          symbol?: string | null
          token_age_seconds?: number | null
          top_holder_percentage?: number | null
          updated_at?: string
          volume_1h?: number | null
          volume_24h?: number | null
          volume_5m?: number | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          close_reason: string | null
          closed_at: string
          created_at: string
          entry_price: number | null
          execution_provider: Database["public"]["Enums"]["execution_provider"]
          exit_price: number | null
          exit_value: number | null
          external_transaction_hash: string | null
          fees: number
          id: string
          invested_amount: number | null
          opened_at: string | null
          order_id: string | null
          position_id: string | null
          quantity: number | null
          realized_pnl: number | null
          realized_pnl_percent: number | null
          side: Database["public"]["Enums"]["order_side"]
          slippage: number | null
          strategy_id: string | null
          token_id: string | null
          user_id: string
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string
          created_at?: string
          entry_price?: number | null
          execution_provider?: Database["public"]["Enums"]["execution_provider"]
          exit_price?: number | null
          exit_value?: number | null
          external_transaction_hash?: string | null
          fees?: number
          id?: string
          invested_amount?: number | null
          opened_at?: string | null
          order_id?: string | null
          position_id?: string | null
          quantity?: number | null
          realized_pnl?: number | null
          realized_pnl_percent?: number | null
          side?: Database["public"]["Enums"]["order_side"]
          slippage?: number | null
          strategy_id?: string | null
          token_id?: string | null
          user_id: string
        }
        Update: {
          close_reason?: string | null
          closed_at?: string
          created_at?: string
          entry_price?: number | null
          execution_provider?: Database["public"]["Enums"]["execution_provider"]
          exit_price?: number | null
          exit_value?: number | null
          external_transaction_hash?: string | null
          fees?: number
          id?: string
          invested_amount?: number | null
          opened_at?: string | null
          order_id?: string | null
          position_id?: string | null
          quantity?: number | null
          realized_pnl?: number | null
          realized_pnl_percent?: number | null
          side?: Database["public"]["Enums"]["order_side"]
          slippage?: number | null
          strategy_id?: string | null
          token_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_activity: {
        Row: {
          activity_type: Database["public"]["Enums"]["wallet_activity_type"]
          amount: number | null
          created_at: string
          id: string
          metadata: Json
          occurred_at: string
          price: number | null
          token_id: string | null
          transaction_hash: string | null
          wallet_id: string
        }
        Insert: {
          activity_type: Database["public"]["Enums"]["wallet_activity_type"]
          amount?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          price?: number | null
          token_id?: string | null
          transaction_hash?: string | null
          wallet_id: string
        }
        Update: {
          activity_type?: Database["public"]["Enums"]["wallet_activity_type"]
          amount?: number | null
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          price?: number | null
          token_id?: string | null
          transaction_hash?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_activity_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_activity_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_watchlist: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          label: string | null
          user_id: string
          wallet_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string | null
          user_id: string
          wallet_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string | null
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_watchlist_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          address: string
          chain: string
          created_at: string
          data_source: string | null
          id: string
          is_tracked: boolean
          label: string | null
          last_provider_sync: string | null
          realized_pnl: number | null
          smart_money_score: number | null
          total_trades: number | null
          updated_at: string
          wallet_type: Database["public"]["Enums"]["wallet_type"]
          win_rate: number | null
        }
        Insert: {
          address: string
          chain?: string
          created_at?: string
          data_source?: string | null
          id?: string
          is_tracked?: boolean
          label?: string | null
          last_provider_sync?: string | null
          realized_pnl?: number | null
          smart_money_score?: number | null
          total_trades?: number | null
          updated_at?: string
          wallet_type?: Database["public"]["Enums"]["wallet_type"]
          win_rate?: number | null
        }
        Update: {
          address?: string
          chain?: string
          created_at?: string
          data_source?: string | null
          id?: string
          is_tracked?: boolean
          label?: string | null
          last_provider_sync?: string | null
          realized_pnl?: number | null
          smart_money_score?: number | null
          total_trades?: number | null
          updated_at?: string
          wallet_type?: Database["public"]["Enums"]["wallet_type"]
          win_rate?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_job_lease: {
        Args: { _holder: string; _job_name: string; _ttl_seconds: number }
        Returns: boolean
      }
      release_job_lease: {
        Args: { _job_name: string; _result: Json }
        Returns: undefined
      }
    }
    Enums: {
      bot_state:
        | "OFFLINE"
        | "STARTING"
        | "SCANNING"
        | "ANALYZING"
        | "READY"
        | "TRADING"
        | "PAUSED"
        | "RISK_PAUSED"
        | "ERROR"
        | "KILLED"
      execution_provider: "PAPER" | "GMGN"
      log_level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL"
      order_side: "BUY" | "SELL"
      order_status:
        | "CREATED"
        | "VALIDATING"
        | "APPROVED"
        | "REJECTED"
        | "SUBMITTED"
        | "PARTIALLY_FILLED"
        | "FILLED"
        | "CANCELLED"
        | "FAILED"
      order_type:
        | "MARKET"
        | "LIMIT"
        | "TAKE_PROFIT"
        | "STOP_LOSS"
        | "TRAILING_STOP"
      position_side: "LONG" | "SHORT"
      position_status: "OPEN" | "CLOSING" | "CLOSED" | "FAILED"
      relationship_type:
        | "SMART_MONEY_OVERLAP"
        | "WALLET_OVERLAP"
        | "TRADING_CORRELATION"
        | "TOKEN_CLUSTER"
        | "LIQUIDITY_RELATIONSHIP"
        | "HOLDER_OVERLAP"
      risk_event_type:
        | "DAILY_LOSS_LIMIT"
        | "TRADE_LOSS_LIMIT"
        | "MAX_POSITIONS"
        | "MAX_EXPOSURE"
        | "HIGH_SLIPPAGE"
        | "LOW_LIQUIDITY"
        | "LOW_SCORE"
        | "BLACKLISTED_TOKEN"
        | "CONSECUTIVE_LOSSES"
        | "SYSTEM_ERROR"
        | "MANUAL_KILL"
      risk_severity: "INFO" | "WARNING" | "CRITICAL"
      signal_direction: "BULLISH" | "BEARISH" | "NEUTRAL"
      signal_source: "GMGN" | "STRATEGY_ENGINE" | "SYSTEM" | "USER"
      signal_status: "NEW" | "ACKNOWLEDGED" | "ACTED" | "EXPIRED" | "DISMISSED"
      signal_type:
        | "NEW_TOKEN"
        | "SMART_MONEY_BUY"
        | "MOMENTUM"
        | "VOLUME_ACCELERATION"
        | "LIQUIDITY_CHANGE"
        | "BUY_PRESSURE"
        | "BREAKOUT"
        | "REVERSAL"
        | "RISK_WARNING"
      strategy_mode: "PAPER" | "LIVE"
      wallet_activity_type:
        | "BUY"
        | "SELL"
        | "TRANSFER"
        | "ADD_LIQUIDITY"
        | "REMOVE_LIQUIDITY"
      wallet_type:
        | "SMART_MONEY"
        | "KOL"
        | "WHALE"
        | "INSIDER"
        | "BUNDLER"
        | "UNKNOWN"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      bot_state: [
        "OFFLINE",
        "STARTING",
        "SCANNING",
        "ANALYZING",
        "READY",
        "TRADING",
        "PAUSED",
        "RISK_PAUSED",
        "ERROR",
        "KILLED",
      ],
      execution_provider: ["PAPER", "GMGN"],
      log_level: ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
      order_side: ["BUY", "SELL"],
      order_status: [
        "CREATED",
        "VALIDATING",
        "APPROVED",
        "REJECTED",
        "SUBMITTED",
        "PARTIALLY_FILLED",
        "FILLED",
        "CANCELLED",
        "FAILED",
      ],
      order_type: [
        "MARKET",
        "LIMIT",
        "TAKE_PROFIT",
        "STOP_LOSS",
        "TRAILING_STOP",
      ],
      position_side: ["LONG", "SHORT"],
      position_status: ["OPEN", "CLOSING", "CLOSED", "FAILED"],
      relationship_type: [
        "SMART_MONEY_OVERLAP",
        "WALLET_OVERLAP",
        "TRADING_CORRELATION",
        "TOKEN_CLUSTER",
        "LIQUIDITY_RELATIONSHIP",
        "HOLDER_OVERLAP",
      ],
      risk_event_type: [
        "DAILY_LOSS_LIMIT",
        "TRADE_LOSS_LIMIT",
        "MAX_POSITIONS",
        "MAX_EXPOSURE",
        "HIGH_SLIPPAGE",
        "LOW_LIQUIDITY",
        "LOW_SCORE",
        "BLACKLISTED_TOKEN",
        "CONSECUTIVE_LOSSES",
        "SYSTEM_ERROR",
        "MANUAL_KILL",
      ],
      risk_severity: ["INFO", "WARNING", "CRITICAL"],
      signal_direction: ["BULLISH", "BEARISH", "NEUTRAL"],
      signal_source: ["GMGN", "STRATEGY_ENGINE", "SYSTEM", "USER"],
      signal_status: ["NEW", "ACKNOWLEDGED", "ACTED", "EXPIRED", "DISMISSED"],
      signal_type: [
        "NEW_TOKEN",
        "SMART_MONEY_BUY",
        "MOMENTUM",
        "VOLUME_ACCELERATION",
        "LIQUIDITY_CHANGE",
        "BUY_PRESSURE",
        "BREAKOUT",
        "REVERSAL",
        "RISK_WARNING",
      ],
      strategy_mode: ["PAPER", "LIVE"],
      wallet_activity_type: [
        "BUY",
        "SELL",
        "TRANSFER",
        "ADD_LIQUIDITY",
        "REMOVE_LIQUIDITY",
      ],
      wallet_type: [
        "SMART_MONEY",
        "KOL",
        "WHALE",
        "INSIDER",
        "BUNDLER",
        "UNKNOWN",
      ],
    },
  },
} as const
