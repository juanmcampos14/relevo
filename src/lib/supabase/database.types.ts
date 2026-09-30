
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ad_metric_imports": {
                  Row: {
                    "account_timezone": string | null,"created_at": string,"currency": string | null,"experiment_id": string,"file_name": string,"file_sha256": string,"file_text": string,"id": string,"imported_by": string | null,"period_end": string | null,"period_start": string | null,"rejected": NonNullable<Json>,"rows_applied": number,"rows_total": number,"unmatched": NonNullable<Json>,"workspace_id": string
                  }
                  Insert: {
                    "account_timezone"?: string | null,"created_at"?: string,"currency"?: string | null,"experiment_id": string,"file_name": string,"file_sha256": string,"file_text": string,"id"?: string,"imported_by"?: string | null,"period_end"?: string | null,"period_start"?: string | null,"rejected"?: NonNullable<Json>,"rows_applied"?: number,"rows_total"?: number,"unmatched"?: NonNullable<Json>,"workspace_id": string
                  }
                  Update: {
                    "account_timezone"?: string | null,"created_at"?: string,"currency"?: string | null,"experiment_id"?: string,"file_name"?: string,"file_sha256"?: string,"file_text"?: string,"id"?: string,"imported_by"?: string | null,"period_end"?: string | null,"period_start"?: string | null,"rejected"?: NonNullable<Json>,"rows_applied"?: number,"rows_total"?: number,"unmatched"?: NonNullable<Json>,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_metric_imports_workspace_id_experiment_id_fkey"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"ad_metrics_daily": {
                  Row: {
                    "ad_name": string | null,"currency": string,"day": string,"experiment_id": string,"id": string,"import_id": string,"impressions": number | null,"landing_page_views": number | null,"link_clicks": number | null,"meta_ad_id": string,"meta_adset_id": string | null,"meta_campaign_id": string | null,"reach": number | null,"spend": number,"updated_at": string,"variant_code": string | null,"workspace_id": string
                  }
                  Insert: {
                    "ad_name"?: string | null,"currency": string,"day": string,"experiment_id": string,"id"?: string,"import_id": string,"impressions"?: number | null,"landing_page_views"?: number | null,"link_clicks"?: number | null,"meta_ad_id": string,"meta_adset_id"?: string | null,"meta_campaign_id"?: string | null,"reach"?: number | null,"spend"?: number,"updated_at"?: string,"variant_code"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "ad_name"?: string | null,"currency"?: string,"day"?: string,"experiment_id"?: string,"id"?: string,"import_id"?: string,"impressions"?: number | null,"landing_page_views"?: number | null,"link_clicks"?: number | null,"meta_ad_id"?: string,"meta_adset_id"?: string | null,"meta_campaign_id"?: string | null,"reach"?: number | null,"spend"?: number,"updated_at"?: string,"variant_code"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ad_metrics_daily_workspace_id_experiment_id_fkey"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "ad_metrics_daily_workspace_id_import_id_fkey"
      columns: ["workspace_id","import_id"]
isOneToOne: false
      referencedRelation: "ad_metric_imports"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"ai_action_drafts": {
                  Row: {
                    "action": string,"after_state": Json | null,"before_state": Json | null,"conversation_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"error": string | null,"evidence_refs": NonNullable<Json>,"id": string,"message_id": string | null,"payload": NonNullable<Json>,"preview": NonNullable<Json>,"rationale": string | null,"result_ref": string | null,"status": string,"workspace_id": string
                  }
                  Insert: {
                    "action": string,"after_state"?: Json | null,"before_state"?: Json | null,"conversation_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"error"?: string | null,"evidence_refs"?: NonNullable<Json>,"id"?: string,"message_id"?: string | null,"payload": NonNullable<Json>,"preview"?: NonNullable<Json>,"rationale"?: string | null,"result_ref"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "action"?: string,"after_state"?: Json | null,"before_state"?: Json | null,"conversation_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"error"?: string | null,"evidence_refs"?: NonNullable<Json>,"id"?: string,"message_id"?: string | null,"payload"?: NonNullable<Json>,"preview"?: NonNullable<Json>,"rationale"?: string | null,"result_ref"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_action_drafts_workspace_id_conversation_id_fkey"
      columns: ["workspace_id","conversation_id"]
isOneToOne: false
      referencedRelation: "ai_conversations"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"ai_conversations": {
                  Row: {
                    "created_at": string,"id": string,"scope": NonNullable<Json>,"title": string,"updated_at": string,"user_id": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"scope"?: NonNullable<Json>,"title"?: string,"updated_at"?: string,"user_id"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"scope"?: NonNullable<Json>,"title"?: string,"updated_at"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_conversations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_messages": {
                  Row: {
                    "api_content": Json | null,"citations": NonNullable<Json>,"conversation_id": string,"created_at": string,"id": string,"role": string,"run_id": string | null,"text": string,"workspace_id": string
                  }
                  Insert: {
                    "api_content"?: Json | null,"citations"?: NonNullable<Json>,"conversation_id": string,"created_at"?: string,"id"?: string,"role": string,"run_id"?: string | null,"text"?: string,"workspace_id": string
                  }
                  Update: {
                    "api_content"?: Json | null,"citations"?: NonNullable<Json>,"conversation_id"?: string,"created_at"?: string,"id"?: string,"role"?: string,"run_id"?: string | null,"text"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_messages_workspace_id_conversation_id_fkey"
      columns: ["workspace_id","conversation_id"]
isOneToOne: false
      referencedRelation: "ai_conversations"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"ai_runs": {
                  Row: {
                    "cache_read_tokens": number,"cache_write_tokens": number,"conversation_id": string | null,"cost_usd": number,"created_at": string,"duration_ms": number | null,"error": string | null,"id": string,"input_tokens": number,"model": string,"output_tokens": number,"prompt_version": string,"status": string,"tool_calls": number,"user_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"conversation_id"?: string | null,"cost_usd"?: number,"created_at"?: string,"duration_ms"?: number | null,"error"?: string | null,"id"?: string,"input_tokens"?: number,"model": string,"output_tokens"?: number,"prompt_version": string,"status": string,"tool_calls"?: number,"user_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"conversation_id"?: string | null,"cost_usd"?: number,"created_at"?: string,"duration_ms"?: number | null,"error"?: string | null,"id"?: string,"input_tokens"?: number,"model"?: string,"output_tokens"?: number,"prompt_version"?: string,"status"?: string,"tool_calls"?: number,"user_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_runs_workspace_id_conversation_id_fkey"
      columns: ["workspace_id","conversation_id"]
isOneToOne: false
      referencedRelation: "ai_conversations"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "ai_runs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"asset_parties": {
                  Row: {
                    "asset_id": string,"company_id": string | null,"contact_id": string | null,"created_at": string,"created_by": string | null,"evidence_id": string | null,"id": string,"notes": string | null,"role": string,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "asset_id": string,"company_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"evidence_id"?: string | null,"id"?: string,"notes"?: string | null,"role": string,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string,"company_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"evidence_id"?: string | null,"id"?: string,"notes"?: string | null,"role"?: string,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_parties_workspace_id_asset_id_fkey"
      columns: ["workspace_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "asset_parties_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "asset_parties_workspace_id_contact_id_fkey"
      columns: ["workspace_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "asset_parties_workspace_id_evidence_id_fkey"
      columns: ["workspace_id","evidence_id"]
isOneToOne: false
      referencedRelation: "evidence"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "asset_parties_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"assets": {
                  Row: {
                    "address_status": string,"address_text": string | null,"country": string | null,"created_at": string,"created_by": string | null,"establishment_id": string | null,"id": string,"is_demo": boolean,"kind": string,"latitude": number | null,"locality": string | null,"location_accuracy_m": number | null,"location_source": string | null,"location_source_id": string | null,"location_status": string | null,"location_verified_at": string | null,"longitude": number | null,"notes": string | null,"operation": string,"price_amount": number | null,"price_currency": string | null,"price_observed_on": string | null,"price_source_id": string | null,"province": string | null,"source_id": string | null,"surface_m2": number | null,"title": string,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "address_status"?: string,"address_text"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"establishment_id"?: string | null,"id"?: string,"is_demo"?: boolean,"kind": string,"latitude"?: number | null,"locality"?: string | null,"location_accuracy_m"?: number | null,"location_source"?: string | null,"location_source_id"?: string | null,"location_status"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"notes"?: string | null,"operation"?: string,"price_amount"?: number | null,"price_currency"?: string | null,"price_observed_on"?: string | null,"price_source_id"?: string | null,"province"?: string | null,"source_id"?: string | null,"surface_m2"?: number | null,"title": string,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "address_status"?: string,"address_text"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"establishment_id"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"latitude"?: number | null,"locality"?: string | null,"location_accuracy_m"?: number | null,"location_source"?: string | null,"location_source_id"?: string | null,"location_status"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"notes"?: string | null,"operation"?: string,"price_amount"?: number | null,"price_currency"?: string | null,"price_observed_on"?: string | null,"price_source_id"?: string | null,"province"?: string | null,"source_id"?: string | null,"surface_m2"?: number | null,"title"?: string,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assets_workspace_id_establishment_id_fkey"
      columns: ["workspace_id","establishment_id"]
isOneToOne: false
      referencedRelation: "establishments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "assets_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assets_workspace_id_location_source_id_fkey"
      columns: ["workspace_id","location_source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "assets_workspace_id_price_source_id_fkey"
      columns: ["workspace_id","price_source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "assets_workspace_id_source_id_fkey"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"changes": Json | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": number,"workspace_id": string | null
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"changes"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: never,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"changes"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: never,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"brief_candidates": {
                  Row: {
                    "brief_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"detail": string | null,"entity_ref": string | null,"id": string,"kind": string,"name": string,"source_url": string | null,"status": string,"workspace_id": string
                  }
                  Insert: {
                    "brief_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"detail"?: string | null,"entity_ref"?: string | null,"id"?: string,"kind": string,"name": string,"source_url"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "brief_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"detail"?: string | null,"entity_ref"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"source_url"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brief_candidates_workspace_id_brief_id_fkey"
      columns: ["workspace_id","brief_id"]
isOneToOne: false
      referencedRelation: "briefs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "brief_candidates_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"brief_deliveries": {
                  Row: {
                    "attempts": number,"brief_id": string,"created_at": string,"error": string | null,"id": string,"last_attempt_at": string | null,"provider": string | null,"provider_message_id": string | null,"recipient_email": string,"recipient_name": string | null,"sent_at": string | null,"status": string,"workspace_id": string
                  }
                  Insert: {
                    "attempts"?: number,"brief_id": string,"created_at"?: string,"error"?: string | null,"id"?: string,"last_attempt_at"?: string | null,"provider"?: string | null,"provider_message_id"?: string | null,"recipient_email": string,"recipient_name"?: string | null,"sent_at"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "attempts"?: number,"brief_id"?: string,"created_at"?: string,"error"?: string | null,"id"?: string,"last_attempt_at"?: string | null,"provider"?: string | null,"provider_message_id"?: string | null,"recipient_email"?: string,"recipient_name"?: string | null,"sent_at"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brief_deliveries_workspace_id_brief_id_fkey"
      columns: ["workspace_id","brief_id"]
isOneToOne: false
      referencedRelation: "briefs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "brief_deliveries_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"brief_signals": {
                  Row: {
                    "asset_ids": (string)[],"basis": string,"brief_id": string,"campaign_ids": (string)[],"change": string,"companies": (string)[],"company_ids": (string)[],"created_at": string,"finding_ids": (string)[],"geography": string | null,"happened_on": string | null,"headline": string,"id": string,"people": (string)[],"position": number,"publisher": string | null,"reading": string | null,"relevance": string,"roles": (string)[],"section": string,"signal_type": string,"source_title": string | null,"source_url": string | null,"status": string,"story_id": string | null,"subsector": string | null,"suggested_action": string | null,"summary": string | null,"vertical": string | null,"why_it_matters": string | null,"workspace_id": string
                  }
                  Insert: {
                    "asset_ids"?: (string)[],"basis": string,"brief_id": string,"campaign_ids"?: (string)[],"change": string,"companies"?: (string)[],"company_ids"?: (string)[],"created_at"?: string,"finding_ids"?: (string)[],"geography"?: string | null,"happened_on"?: string | null,"headline": string,"id"?: string,"people"?: (string)[],"position"?: number,"publisher"?: string | null,"reading"?: string | null,"relevance": string,"roles"?: (string)[],"section": string,"signal_type": string,"source_title"?: string | null,"source_url"?: string | null,"status"?: string,"story_id"?: string | null,"subsector"?: string | null,"suggested_action"?: string | null,"summary"?: string | null,"vertical"?: string | null,"why_it_matters"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "asset_ids"?: (string)[],"basis"?: string,"brief_id"?: string,"campaign_ids"?: (string)[],"change"?: string,"companies"?: (string)[],"company_ids"?: (string)[],"created_at"?: string,"finding_ids"?: (string)[],"geography"?: string | null,"happened_on"?: string | null,"headline"?: string,"id"?: string,"people"?: (string)[],"position"?: number,"publisher"?: string | null,"reading"?: string | null,"relevance"?: string,"roles"?: (string)[],"section"?: string,"signal_type"?: string,"source_title"?: string | null,"source_url"?: string | null,"status"?: string,"story_id"?: string | null,"subsector"?: string | null,"suggested_action"?: string | null,"summary"?: string | null,"vertical"?: string | null,"why_it_matters"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brief_signals_workspace_id_brief_id_fkey"
      columns: ["workspace_id","brief_id"]
isOneToOne: false
      referencedRelation: "briefs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "brief_signals_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "brief_signals_workspace_id_story_id_fkey"
      columns: ["workspace_id","story_id"]
isOneToOne: false
      referencedRelation: "brief_stories"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"brief_source_items": {
                  Row: {
                    "first_brief_id": string | null,"id": string,"published_at": string | null,"publisher": string | null,"seen_at": string,"title": string | null,"url": string,"workspace_id": string
                  }
                  Insert: {
                    "first_brief_id"?: string | null,"id"?: string,"published_at"?: string | null,"publisher"?: string | null,"seen_at"?: string,"title"?: string | null,"url": string,"workspace_id": string
                  }
                  Update: {
                    "first_brief_id"?: string | null,"id"?: string,"published_at"?: string | null,"publisher"?: string | null,"seen_at"?: string,"title"?: string | null,"url"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brief_source_items_workspace_id_first_brief_id_fkey"
      columns: ["workspace_id","first_brief_id"]
isOneToOne: false
      referencedRelation: "briefs"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "brief_source_items_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"brief_stories": {
                  Row: {
                    "created_at": string,"first_seen_on": string,"id": string,"last_brief_id": string | null,"last_seen_on": string,"status": string,"summary": string | null,"title": string,"updated_at": string,"vertical": string | null,"watch_reason": string | null,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"first_seen_on": string,"id"?: string,"last_brief_id"?: string | null,"last_seen_on": string,"status"?: string,"summary"?: string | null,"title": string,"updated_at"?: string,"vertical"?: string | null,"watch_reason"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"first_seen_on"?: string,"id"?: string,"last_brief_id"?: string | null,"last_seen_on"?: string,"status"?: string,"summary"?: string | null,"title"?: string,"updated_at"?: string,"vertical"?: string | null,"watch_reason"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brief_stories_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "brief_stories_workspace_id_last_brief_id_fkey"
      columns: ["workspace_id","last_brief_id"]
isOneToOne: false
      referencedRelation: "briefs"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"briefings": {
                  Row: {
                    "audience_user_id": string | null,"content": NonNullable<Json>,"created_at": string,"created_by": string | null,"id": string,"period_end": string,"period_start": string,"published_at": string | null,"scope": string,"status": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "audience_user_id"?: string | null,"content": NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"period_end": string,"period_start": string,"published_at"?: string | null,"scope": string,"status"?: string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "audience_user_id"?: string | null,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"id"?: string,"period_end"?: string,"period_start"?: string,"published_at"?: string | null,"scope"?: string,"status"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "briefings_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"briefs": {
                  Row: {
                    "attempts": number,"brief_date": string,"collected": NonNullable<Json>,"content": NonNullable<Json>,"created_at": string,"engines": NonNullable<Json>,"error": string | null,"generated_at": string | null,"id": string,"period_end": string,"period_start": string,"research": NonNullable<Json>,"status": string,"step_started_at": string | null,"usage": NonNullable<Json>,"version": string,"workspace_id": string
                  }
                  Insert: {
                    "attempts"?: number,"brief_date": string,"collected"?: NonNullable<Json>,"content"?: NonNullable<Json>,"created_at"?: string,"engines"?: NonNullable<Json>,"error"?: string | null,"generated_at"?: string | null,"id"?: string,"period_end": string,"period_start": string,"research"?: NonNullable<Json>,"status"?: string,"step_started_at"?: string | null,"usage"?: NonNullable<Json>,"version": string,"workspace_id": string
                  }
                  Update: {
                    "attempts"?: number,"brief_date"?: string,"collected"?: NonNullable<Json>,"content"?: NonNullable<Json>,"created_at"?: string,"engines"?: NonNullable<Json>,"error"?: string | null,"generated_at"?: string | null,"id"?: string,"period_end"?: string,"period_start"?: string,"research"?: NonNullable<Json>,"status"?: string,"step_started_at"?: string | null,"usage"?: NonNullable<Json>,"version"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "briefs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_targets": {
                  Row: {
                    "asset_id": string | null,"campaign_id": string,"company_id": string | null,"created_at": string,"created_by": string | null,"discard_reason": string | null,"establishment_id": string | null,"id": string,"next_action": string | null,"next_action_due": string | null,"owner_id": string | null,"priority": number,"status": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "asset_id"?: string | null,"campaign_id": string,"company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"discard_reason"?: string | null,"establishment_id"?: string | null,"id"?: string,"next_action"?: string | null,"next_action_due"?: string | null,"owner_id"?: string | null,"priority"?: number,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string | null,"campaign_id"?: string,"company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"discard_reason"?: string | null,"establishment_id"?: string | null,"id"?: string,"next_action"?: string | null,"next_action_due"?: string | null,"owner_id"?: string | null,"priority"?: number,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_targets_workspace_id_asset_id_fkey"
      columns: ["workspace_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "campaign_targets_workspace_id_campaign_id_fkey"
      columns: ["workspace_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "campaign_targets_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "campaign_targets_workspace_id_establishment_id_fkey"
      columns: ["workspace_id","establishment_id"]
isOneToOne: false
      referencedRelation: "establishments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "campaign_targets_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_verticals": {
                  Row: {
                    "campaign_id": string,"created_at": string,"vertical_id": string,"workspace_id": string
                  }
                  Insert: {
                    "campaign_id": string,"created_at"?: string,"vertical_id": string,"workspace_id": string
                  }
                  Update: {
                    "campaign_id"?: string,"created_at"?: string,"vertical_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_verticals_workspace_id_campaign_id_fkey"
      columns: ["workspace_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "campaign_verticals_workspace_id_vertical_id_fkey"
      columns: ["workspace_id","vertical_id"]
isOneToOne: false
      referencedRelation: "verticals"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "created_at": string,"created_by": string | null,"ends_on": string | null,"id": string,"kind": string,"name": string,"objective": string | null,"owner_id": string | null,"starts_on": string | null,"status": string,"updated_at": string,"workspace_id": string,"zone": string | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"kind"?: string,"name": string,"objective"?: string | null,"owner_id"?: string | null,"starts_on"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id": string,"zone"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"objective"?: string | null,"owner_id"?: string | null,"starts_on"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string,"zone"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"capture_media": {
                  Row: {
                    "capture_id": string,"created_at": string,"duration_ms": number | null,"id": string,"kind": string,"mime_type": string,"sha256": string | null,"size_bytes": number | null,"storage_path": string,"workspace_id": string
                  }
                  Insert: {
                    "capture_id": string,"created_at"?: string,"duration_ms"?: number | null,"id"?: string,"kind": string,"mime_type": string,"sha256"?: string | null,"size_bytes"?: number | null,"storage_path": string,"workspace_id": string
                  }
                  Update: {
                    "capture_id"?: string,"created_at"?: string,"duration_ms"?: number | null,"id"?: string,"kind"?: string,"mime_type"?: string,"sha256"?: string | null,"size_bytes"?: number | null,"storage_path"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "capture_media_workspace_id_capture_id_fkey"
      columns: ["workspace_id","capture_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "capture_media_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"captures": {
                  Row: {
                    "ai_consent": boolean,"ai_run_id": string | null,"ai_summary": string | null,"ai_unknowns": (string)[],"body": string | null,"campaign_id": string | null,"captured_at": string,"captured_by": string | null,"client_id": string,"content_hash": string | null,"created_at": string,"duplicate_of": string | null,"id": string,"latitude": number | null,"location_accuracy_m": number | null,"location_status": string | null,"longitude": number | null,"processed_at": string | null,"source_id": string | null,"status": string,"status_error": string | null,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "ai_consent"?: boolean,"ai_run_id"?: string | null,"ai_summary"?: string | null,"ai_unknowns"?: (string)[],"body"?: string | null,"campaign_id"?: string | null,"captured_at": string,"captured_by"?: string | null,"client_id": string,"content_hash"?: string | null,"created_at"?: string,"duplicate_of"?: string | null,"id"?: string,"latitude"?: number | null,"location_accuracy_m"?: number | null,"location_status"?: string | null,"longitude"?: number | null,"processed_at"?: string | null,"source_id"?: string | null,"status"?: string,"status_error"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "ai_consent"?: boolean,"ai_run_id"?: string | null,"ai_summary"?: string | null,"ai_unknowns"?: (string)[],"body"?: string | null,"campaign_id"?: string | null,"captured_at"?: string,"captured_by"?: string | null,"client_id"?: string,"content_hash"?: string | null,"created_at"?: string,"duplicate_of"?: string | null,"id"?: string,"latitude"?: number | null,"location_accuracy_m"?: number | null,"location_status"?: string | null,"longitude"?: number | null,"processed_at"?: string | null,"source_id"?: string | null,"status"?: string,"status_error"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "captures_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "captures_duplicate_fk"
      columns: ["workspace_id","duplicate_of"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "captures_source_fk"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "captures_workspace_id_campaign_id_fkey"
      columns: ["workspace_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "captures_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"comments": {
                  Row: {
                    "author_id": string,"body": string,"briefing_id": string | null,"created_at": string,"decision_id": string | null,"finding_id": string | null,"id": string,"opportunity_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "author_id"?: string,"body": string,"briefing_id"?: string | null,"created_at"?: string,"decision_id"?: string | null,"finding_id"?: string | null,"id"?: string,"opportunity_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"briefing_id"?: string | null,"created_at"?: string,"decision_id"?: string | null,"finding_id"?: string | null,"id"?: string,"opportunity_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_workspace_id_briefing_id_fkey"
      columns: ["workspace_id","briefing_id"]
isOneToOne: false
      referencedRelation: "briefings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "comments_workspace_id_decision_id_fkey"
      columns: ["workspace_id","decision_id"]
isOneToOne: false
      referencedRelation: "decisions"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "comments_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "comments_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_workspace_id_opportunity_id_fkey"
      columns: ["workspace_id","opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "activity": string | null,"created_at": string,"created_by": string | null,"drive_folder_url": string | null,"id": string,"is_demo": boolean,"kind": string,"legal_name": string | null,"locality": string | null,"notes": string | null,"public_phone": string | null,"sector": string | null,"source_id": string | null,"tax_id": string | null,"trade_name": string | null,"updated_at": string,"verification_status": string,"website": string | null,"workspace_id": string
                  }
                  Insert: {
                    "activity"?: string | null,"created_at"?: string,"created_by"?: string | null,"drive_folder_url"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"legal_name"?: string | null,"locality"?: string | null,"notes"?: string | null,"public_phone"?: string | null,"sector"?: string | null,"source_id"?: string | null,"tax_id"?: string | null,"trade_name"?: string | null,"updated_at"?: string,"verification_status"?: string,"website"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "activity"?: string | null,"created_at"?: string,"created_by"?: string | null,"drive_folder_url"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"legal_name"?: string | null,"locality"?: string | null,"notes"?: string | null,"public_phone"?: string | null,"sector"?: string | null,"source_id"?: string | null,"tax_id"?: string | null,"trade_name"?: string | null,"updated_at"?: string,"verification_status"?: string,"website"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "companies_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "companies_workspace_id_source_id_fkey"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"contact_links": {
                  Row: {
                    "asset_id": string | null,"company_id": string | null,"contact_id": string,"created_at": string,"establishment_id": string | null,"id": string,"relation": string,"workspace_id": string
                  }
                  Insert: {
                    "asset_id"?: string | null,"company_id"?: string | null,"contact_id": string,"created_at"?: string,"establishment_id"?: string | null,"id"?: string,"relation"?: string,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string | null,"company_id"?: string | null,"contact_id"?: string,"created_at"?: string,"establishment_id"?: string | null,"id"?: string,"relation"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_links_workspace_id_asset_id_fkey"
      columns: ["workspace_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "contact_links_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "contact_links_workspace_id_contact_id_fkey"
      columns: ["workspace_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "contact_links_workspace_id_establishment_id_fkey"
      columns: ["workspace_id","establishment_id"]
isOneToOne: false
      referencedRelation: "establishments"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "contact_kind": string,"contact_permission": string,"created_at": string,"created_by": string | null,"email": string | null,"full_name": string,"id": string,"introduced_by": string | null,"is_demo": boolean,"notes": string | null,"outreach_draft": string | null,"phone": string | null,"preferred_channel": string | null,"profile_url": string | null,"relationship_status": string | null,"role_title": string | null,"source_id": string | null,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "contact_kind"?: string,"contact_permission"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"full_name": string,"id"?: string,"introduced_by"?: string | null,"is_demo"?: boolean,"notes"?: string | null,"outreach_draft"?: string | null,"phone"?: string | null,"preferred_channel"?: string | null,"profile_url"?: string | null,"relationship_status"?: string | null,"role_title"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "contact_kind"?: string,"contact_permission"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"full_name"?: string,"id"?: string,"introduced_by"?: string | null,"is_demo"?: boolean,"notes"?: string | null,"outreach_draft"?: string | null,"phone"?: string | null,"preferred_channel"?: string | null,"profile_url"?: string | null,"relationship_status"?: string | null,"role_title"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_workspace_id_source_id_fkey"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"context_documents": {
                  Row: {
                    "body": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"source_url": string | null,"status": string,"summary": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "body": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"source_url"?: string | null,"status"?: string,"summary"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"source_url"?: string | null,"status"?: string,"summary"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "context_documents_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"decisions": {
                  Row: {
                    "context": string | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"due_on": string | null,"experiment_id": string | null,"id": string,"kind": string,"opportunity_id": string | null,"question": string,"requested_by": string | null,"status": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "context"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"due_on"?: string | null,"experiment_id"?: string | null,"id"?: string,"kind"?: string,"opportunity_id"?: string | null,"question": string,"requested_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "context"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"due_on"?: string | null,"experiment_id"?: string | null,"id"?: string,"kind"?: string,"opportunity_id"?: string | null,"question"?: string,"requested_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "decisions_experiment_fk"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "decisions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decisions_workspace_id_opportunity_id_fkey"
      columns: ["workspace_id","opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"establishments": {
                  Row: {
                    "address_status": string,"address_text": string | null,"company_id": string | null,"country": string | null,"created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"latitude": number | null,"locality": string | null,"location_accuracy_m": number | null,"location_source": string | null,"location_source_id": string | null,"location_status": string | null,"location_verified_at": string | null,"longitude": number | null,"name": string,"notes": string | null,"province": string | null,"source_id": string | null,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "address_status"?: string,"address_text"?: string | null,"company_id"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"latitude"?: number | null,"locality"?: string | null,"location_accuracy_m"?: number | null,"location_source"?: string | null,"location_source_id"?: string | null,"location_status"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"name": string,"notes"?: string | null,"province"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "address_status"?: string,"address_text"?: string | null,"company_id"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"latitude"?: number | null,"locality"?: string | null,"location_accuracy_m"?: number | null,"location_source"?: string | null,"location_source_id"?: string | null,"location_status"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"name"?: string,"notes"?: string | null,"province"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "establishments_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "establishments_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "establishments_workspace_id_location_source_id_fkey"
      columns: ["workspace_id","location_source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "establishments_workspace_id_source_id_fkey"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"evidence": {
                  Row: {
                    "about_unresolved_id": string | null,"asset_id": string | null,"campaign_id": string | null,"capture_id": string | null,"capture_media_id": string | null,"company_id": string | null,"contact_id": string | null,"created_at": string,"created_by": string | null,"declared_by": string | null,"establishment_id": string | null,"evidence_type": string,"id": string,"is_demo": boolean,"media_end_ms": number | null,"media_start_ms": number | null,"next_verification_step": string | null,"observed_at": string | null,"origin_kind": string,"quote": string | null,"revalidate_after": string | null,"source_id": string | null,"stated_by_contact_id": string | null,"stated_by_unresolved_id": string | null,"statement": string,"survey_response_id": string | null,"updated_at": string,"value_currency": string | null,"value_number": number | null,"value_unit": string | null,"verification_status": string,"visit_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "about_unresolved_id"?: string | null,"asset_id"?: string | null,"campaign_id"?: string | null,"capture_id"?: string | null,"capture_media_id"?: string | null,"company_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"declared_by"?: string | null,"establishment_id"?: string | null,"evidence_type"?: string,"id"?: string,"is_demo"?: boolean,"media_end_ms"?: number | null,"media_start_ms"?: number | null,"next_verification_step"?: string | null,"observed_at"?: string | null,"origin_kind": string,"quote"?: string | null,"revalidate_after"?: string | null,"source_id"?: string | null,"stated_by_contact_id"?: string | null,"stated_by_unresolved_id"?: string | null,"statement": string,"survey_response_id"?: string | null,"updated_at"?: string,"value_currency"?: string | null,"value_number"?: number | null,"value_unit"?: string | null,"verification_status"?: string,"visit_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "about_unresolved_id"?: string | null,"asset_id"?: string | null,"campaign_id"?: string | null,"capture_id"?: string | null,"capture_media_id"?: string | null,"company_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"declared_by"?: string | null,"establishment_id"?: string | null,"evidence_type"?: string,"id"?: string,"is_demo"?: boolean,"media_end_ms"?: number | null,"media_start_ms"?: number | null,"next_verification_step"?: string | null,"observed_at"?: string | null,"origin_kind"?: string,"quote"?: string | null,"revalidate_after"?: string | null,"source_id"?: string | null,"stated_by_contact_id"?: string | null,"stated_by_unresolved_id"?: string | null,"statement"?: string,"survey_response_id"?: string | null,"updated_at"?: string,"value_currency"?: string | null,"value_number"?: number | null,"value_unit"?: string | null,"verification_status"?: string,"visit_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "evidence_about_unresolved_fk"
      columns: ["workspace_id","about_unresolved_id"]
isOneToOne: false
      referencedRelation: "unresolved_entities"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_stated_by_unresolved_fk"
      columns: ["workspace_id","stated_by_unresolved_id"]
isOneToOne: false
      referencedRelation: "unresolved_entities"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_survey_response_fk"
      columns: ["workspace_id","survey_response_id"]
isOneToOne: false
      referencedRelation: "survey_responses"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_asset_id_fkey"
      columns: ["workspace_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_campaign_id_fkey"
      columns: ["workspace_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_capture_id_fkey"
      columns: ["workspace_id","capture_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_capture_media_id_fkey"
      columns: ["workspace_id","capture_media_id"]
isOneToOne: false
      referencedRelation: "capture_media"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_contact_id_fkey"
      columns: ["workspace_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_establishment_id_fkey"
      columns: ["workspace_id","establishment_id"]
isOneToOne: false
      referencedRelation: "establishments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "evidence_workspace_id_source_id_fkey"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_stated_by_contact_id_fkey"
      columns: ["workspace_id","stated_by_contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "evidence_workspace_id_visit_id_fkey"
      columns: ["workspace_id","visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"experiment_costs": {
                  Row: {
                    "amount": number,"created_at": string,"created_by": string | null,"currency": string,"document_ref": string | null,"experiment_id": string,"fx_rate": number | null,"id": string,"kind": string,"notes": string | null,"period": string | null,"workspace_id": string
                  }
                  Insert: {
                    "amount": number,"created_at"?: string,"created_by"?: string | null,"currency": string,"document_ref"?: string | null,"experiment_id": string,"fx_rate"?: number | null,"id"?: string,"kind": string,"notes"?: string | null,"period"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"document_ref"?: string | null,"experiment_id"?: string,"fx_rate"?: number | null,"id"?: string,"kind"?: string,"notes"?: string | null,"period"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "experiment_costs_workspace_id_experiment_id_fkey"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"experiment_variants": {
                  Row: {
                    "code": string,"created_at": string,"creative_ref": string | null,"cta": string,"experiment_id": string,"headline": string,"id": string,"label": string,"meta_ad_id": string | null,"meta_adset_id": string | null,"meta_campaign_id": string | null,"primary_text": string,"status": string,"what_changes": string | null,"workspace_id": string
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"creative_ref"?: string | null,"cta": string,"experiment_id": string,"headline": string,"id"?: string,"label": string,"meta_ad_id"?: string | null,"meta_adset_id"?: string | null,"meta_campaign_id"?: string | null,"primary_text": string,"status"?: string,"what_changes"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"creative_ref"?: string | null,"cta"?: string,"experiment_id"?: string,"headline"?: string,"id"?: string,"label"?: string,"meta_ad_id"?: string | null,"meta_adset_id"?: string | null,"meta_campaign_id"?: string | null,"primary_text"?: string,"status"?: string,"what_changes"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "experiment_variants_workspace_id_experiment_id_fkey"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"external_refs": {
                  Row: {
                    "entity_id": string,"entity_type": string,"external_id": string,"first_imported_at": string,"id": string,"last_batch_id": string | null,"last_imported_at": string,"last_values": NonNullable<Json>,"row_number": number | null,"sheet": string | null,"source_file_id": string | null,"source_system": string,"workspace_id": string
                  }
                  Insert: {
                    "entity_id": string,"entity_type": string,"external_id": string,"first_imported_at"?: string,"id"?: string,"last_batch_id"?: string | null,"last_imported_at"?: string,"last_values"?: NonNullable<Json>,"row_number"?: number | null,"sheet"?: string | null,"source_file_id"?: string | null,"source_system": string,"workspace_id": string
                  }
                  Update: {
                    "entity_id"?: string,"entity_type"?: string,"external_id"?: string,"first_imported_at"?: string,"id"?: string,"last_batch_id"?: string | null,"last_imported_at"?: string,"last_values"?: NonNullable<Json>,"row_number"?: number | null,"sheet"?: string | null,"source_file_id"?: string | null,"source_system"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "external_refs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "external_refs_workspace_id_last_batch_id_fkey"
      columns: ["workspace_id","last_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"finding_assessments": {
                  Row: {
                    "ai_run_id": string | null,"contradicts": number,"created_at": string,"created_by": string | null,"dimensions": NonNullable<Json>,"economics": NonNullable<Json>,"evidence_ids": (string)[],"finding_id": string,"gaps": (string)[],"id": string,"independent_cases": number,"summary": string | null,"supports": number,"workspace_id": string
                  }
                  Insert: {
                    "ai_run_id"?: string | null,"contradicts"?: number,"created_at"?: string,"created_by"?: string | null,"dimensions"?: NonNullable<Json>,"economics"?: NonNullable<Json>,"evidence_ids"?: (string)[],"finding_id": string,"gaps"?: (string)[],"id"?: string,"independent_cases"?: number,"summary"?: string | null,"supports"?: number,"workspace_id": string
                  }
                  Update: {
                    "ai_run_id"?: string | null,"contradicts"?: number,"created_at"?: string,"created_by"?: string | null,"dimensions"?: NonNullable<Json>,"economics"?: NonNullable<Json>,"evidence_ids"?: (string)[],"finding_id"?: string,"gaps"?: (string)[],"id"?: string,"independent_cases"?: number,"summary"?: string | null,"supports"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "finding_assessments_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finding_assessments_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "finding_assessments_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"finding_companies": {
                  Row: {
                    "company_id": string,"finding_id": string,"role": string,"workspace_id": string
                  }
                  Insert: {
                    "company_id": string,"finding_id": string,"role"?: string,"workspace_id": string
                  }
                  Update: {
                    "company_id"?: string,"finding_id"?: string,"role"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "finding_companies_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "finding_companies_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"finding_evidence": {
                  Row: {
                    "created_at": string,"created_by": string | null,"evidence_id": string,"finding_id": string,"note": string | null,"stance": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"evidence_id": string,"finding_id": string,"note"?: string | null,"stance": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"evidence_id"?: string,"finding_id"?: string,"note"?: string | null,"stance"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "finding_evidence_workspace_id_evidence_id_fkey"
      columns: ["workspace_id","evidence_id"]
isOneToOne: false
      referencedRelation: "evidence"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "finding_evidence_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "finding_evidence_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"finding_revisions": {
                  Row: {
                    "capture_id": string | null,"created_at": string,"created_by": string | null,"finding_id": string,"id": string,"kind": string,"new_value": string,"previous_value": string,"proposal_id": string | null,"reason": string | null,"relation": string | null,"workspace_id": string
                  }
                  Insert: {
                    "capture_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"finding_id": string,"id"?: string,"kind": string,"new_value": string,"previous_value": string,"proposal_id"?: string | null,"reason"?: string | null,"relation"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "capture_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"finding_id"?: string,"id"?: string,"kind"?: string,"new_value"?: string,"previous_value"?: string,"proposal_id"?: string | null,"reason"?: string | null,"relation"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "finding_revisions_workspace_id_capture_id_fkey"
      columns: ["workspace_id","capture_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "finding_revisions_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "finding_revisions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"findings": {
                  Row: {
                    "analysis": string | null,"asset_id": string | null,"campaign_id": string | null,"case_status": string,"company_id": string | null,"created_at": string,"created_by": string | null,"dedup_key": string | null,"establishment_id": string | null,"evidence": string | null,"id": string,"ingest_meta": Json | null,"ingest_token_id": string | null,"kind": string,"maturity": string,"origin": string,"review_note": string | null,"review_status": string,"reviewed_at": string | null,"reviewed_by": string | null,"source_id": string,"statement": string,"updated_at": string,"verification_status": string,"vertical_id": string | null,"visit_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "analysis"?: string | null,"asset_id"?: string | null,"campaign_id"?: string | null,"case_status"?: string,"company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"dedup_key"?: string | null,"establishment_id"?: string | null,"evidence"?: string | null,"id"?: string,"ingest_meta"?: Json | null,"ingest_token_id"?: string | null,"kind": string,"maturity"?: string,"origin"?: string,"review_note"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source_id": string,"statement": string,"updated_at"?: string,"verification_status"?: string,"vertical_id"?: string | null,"visit_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "analysis"?: string | null,"asset_id"?: string | null,"campaign_id"?: string | null,"case_status"?: string,"company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"dedup_key"?: string | null,"establishment_id"?: string | null,"evidence"?: string | null,"id"?: string,"ingest_meta"?: Json | null,"ingest_token_id"?: string | null,"kind"?: string,"maturity"?: string,"origin"?: string,"review_note"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source_id"?: string,"statement"?: string,"updated_at"?: string,"verification_status"?: string,"vertical_id"?: string | null,"visit_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "findings_ingest_token_fk"
      columns: ["workspace_id","ingest_token_id"]
isOneToOne: false
      referencedRelation: "ingest_tokens"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "findings_workspace_id_asset_id_fkey"
      columns: ["workspace_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "findings_workspace_id_campaign_id_fkey"
      columns: ["workspace_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "findings_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "findings_workspace_id_establishment_id_fkey"
      columns: ["workspace_id","establishment_id"]
isOneToOne: false
      referencedRelation: "establishments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "findings_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "findings_workspace_id_source_id_fkey"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "findings_workspace_id_vertical_id_fkey"
      columns: ["workspace_id","vertical_id"]
isOneToOne: false
      referencedRelation: "verticals"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "findings_workspace_id_visit_id_fkey"
      columns: ["workspace_id","visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"help_requests": {
                  Row: {
                    "ask": string,"assignee_id": string,"created_at": string,"due_on": string | null,"evidence_id": string | null,"finding_id": string | null,"id": string,"kind": string,"requested_by": string | null,"result": string | null,"status": string,"target": string | null,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "ask": string,"assignee_id": string,"created_at"?: string,"due_on"?: string | null,"evidence_id"?: string | null,"finding_id"?: string | null,"id"?: string,"kind": string,"requested_by"?: string | null,"result"?: string | null,"status"?: string,"target"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "ask"?: string,"assignee_id"?: string,"created_at"?: string,"due_on"?: string | null,"evidence_id"?: string | null,"finding_id"?: string | null,"id"?: string,"kind"?: string,"requested_by"?: string | null,"result"?: string | null,"status"?: string,"target"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "help_requests_workspace_id_evidence_id_fkey"
      columns: ["workspace_id","evidence_id"]
isOneToOne: false
      referencedRelation: "evidence"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "help_requests_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "help_requests_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"created_by": string | null,"file_name": string,"file_sha256": string,"id": string,"source_file_id": string | null,"source_system": string,"status": string,"summary": NonNullable<Json>,"workspace_id": string
                  }
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_name": string,"file_sha256": string,"id"?: string,"source_file_id"?: string | null,"source_system": string,"status"?: string,"summary"?: NonNullable<Json>,"workspace_id": string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_name"?: string,"file_sha256"?: string,"id"?: string,"source_file_id"?: string | null,"source_system"?: string,"status"?: string,"summary"?: NonNullable<Json>,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"import_rows": {
                  Row: {
                    "action": string,"applied_at": string | null,"batch_id": string,"conflicts": NonNullable<Json>,"decided_at": string | null,"decided_by": string | null,"decision": string,"entity_type": string,"external_id": string,"id": string,"issues": NonNullable<Json>,"mapped": NonNullable<Json>,"raw": NonNullable<Json>,"resolution": NonNullable<Json>,"row_number": number,"sheet": string,"target_entity_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "action": string,"applied_at"?: string | null,"batch_id": string,"conflicts"?: NonNullable<Json>,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"entity_type": string,"external_id": string,"id"?: string,"issues"?: NonNullable<Json>,"mapped"?: NonNullable<Json>,"raw": NonNullable<Json>,"resolution"?: NonNullable<Json>,"row_number": number,"sheet": string,"target_entity_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "action"?: string,"applied_at"?: string | null,"batch_id"?: string,"conflicts"?: NonNullable<Json>,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: string,"entity_type"?: string,"external_id"?: string,"id"?: string,"issues"?: NonNullable<Json>,"mapped"?: NonNullable<Json>,"raw"?: NonNullable<Json>,"resolution"?: NonNullable<Json>,"row_number"?: number,"sheet"?: string,"target_entity_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_rows_workspace_id_batch_id_fkey"
      columns: ["workspace_id","batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "import_rows_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"ingest_tokens": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"last_used_at": string | null,"name": string,"revoked_at": string | null,"token_hash": string,"token_hint": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"last_used_at"?: string | null,"name": string,"revoked_at"?: string | null,"token_hash": string,"token_hint": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"last_used_at"?: string | null,"name"?: string,"revoked_at"?: string | null,"token_hash"?: string,"token_hint"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ingest_tokens_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "can_approve_decisions": boolean,"created_at": string,"id": string,"role": string,"status": string,"updated_at": string,"user_id": string,"workspace_id": string
                  }
                  Insert: {
                    "can_approve_decisions"?: boolean,"created_at"?: string,"id"?: string,"role": string,"status"?: string,"updated_at"?: string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "can_approve_decisions"?: boolean,"created_at"?: string,"id"?: string,"role"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"news_articles": {
                  Row: {
                    "external_id": string,"fetched_at": string,"finding_id": string | null,"id": string,"image_url": string | null,"provider": string,"published_at": string | null,"snippet": string | null,"source_name": string | null,"source_url": string | null,"title": string,"topic": string,"url": string,"workspace_id": string
                  }
                  Insert: {
                    "external_id": string,"fetched_at"?: string,"finding_id"?: string | null,"id"?: string,"image_url"?: string | null,"provider": string,"published_at"?: string | null,"snippet"?: string | null,"source_name"?: string | null,"source_url"?: string | null,"title": string,"topic": string,"url": string,"workspace_id": string
                  }
                  Update: {
                    "external_id"?: string,"fetched_at"?: string,"finding_id"?: string | null,"id"?: string,"image_url"?: string | null,"provider"?: string,"published_at"?: string | null,"snippet"?: string | null,"source_name"?: string | null,"source_url"?: string | null,"title"?: string,"topic"?: string,"url"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "news_articles_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "news_articles_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"news_fetch_runs": {
                  Row: {
                    "created": number,"created_at": string,"error": string | null,"id": string,"provider": string,"received": number,"status": string,"topic": string,"workspace_id": string
                  }
                  Insert: {
                    "created"?: number,"created_at"?: string,"error"?: string | null,"id"?: string,"provider": string,"received"?: number,"status": string,"topic": string,"workspace_id": string
                  }
                  Update: {
                    "created"?: number,"created_at"?: string,"error"?: string | null,"id"?: string,"provider"?: string,"received"?: number,"status"?: string,"topic"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "news_fetch_runs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"news_refresh_state": {
                  Row: {
                    "last_ok_at": string | null,"locked_until": string | null,"topic": string,"workspace_id": string
                  }
                  Insert: {
                    "last_ok_at"?: string | null,"locked_until"?: string | null,"topic": string,"workspace_id": string
                  }
                  Update: {
                    "last_ok_at"?: string | null,"locked_until"?: string | null,"topic"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "news_refresh_state_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"opportunities": {
                  Row: {
                    "campaign_id": string | null,"created_at": string,"created_by": string | null,"id": string,"idempotency_key": string | null,"next_action": string | null,"next_action_due": string | null,"owner_id": string | null,"route": string,"stage": string | null,"stage_reason": string | null,"status": string,"thesis": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key"?: string | null,"next_action"?: string | null,"next_action_due"?: string | null,"owner_id"?: string | null,"route"?: string,"stage"?: string | null,"stage_reason"?: string | null,"status"?: string,"thesis"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key"?: string | null,"next_action"?: string | null,"next_action_due"?: string | null,"owner_id"?: string | null,"route"?: string,"stage"?: string | null,"stage_reason"?: string | null,"status"?: string,"thesis"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opportunities_workspace_id_campaign_id_fkey"
      columns: ["workspace_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "opportunities_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"opportunity_findings": {
                  Row: {
                    "created_at": string,"finding_id": string,"opportunity_id": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"finding_id": string,"opportunity_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"finding_id"?: string,"opportunity_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opportunity_findings_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "opportunity_findings_workspace_id_opportunity_id_fkey"
      columns: ["workspace_id","opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"email": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"email": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"email"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"proposals": {
                  Row: {
                    "ai_run_id": string | null,"assessment_id": string | null,"capture_id": string | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"final_payload": Json | null,"finding_id": string | null,"id": string,"kind": string,"matches": NonNullable<Json>,"payload": NonNullable<Json>,"position": number,"quote": string | null,"result_id": string | null,"result_type": string | null,"status": string,"workspace_id": string
                  }
                  Insert: {
                    "ai_run_id"?: string | null,"assessment_id"?: string | null,"capture_id"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"final_payload"?: Json | null,"finding_id"?: string | null,"id"?: string,"kind": string,"matches"?: NonNullable<Json>,"payload": NonNullable<Json>,"position": number,"quote"?: string | null,"result_id"?: string | null,"result_type"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "ai_run_id"?: string | null,"assessment_id"?: string | null,"capture_id"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"final_payload"?: Json | null,"finding_id"?: string | null,"id"?: string,"kind"?: string,"matches"?: NonNullable<Json>,"payload"?: NonNullable<Json>,"position"?: number,"quote"?: string | null,"result_id"?: string | null,"result_type"?: string | null,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "proposals_ai_run_id_fkey"
      columns: ["ai_run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "proposals_assessment_fk"
      columns: ["workspace_id","assessment_id"]
isOneToOne: false
      referencedRelation: "finding_assessments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "proposals_finding_fk"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "proposals_workspace_id_capture_id_fkey"
      columns: ["workspace_id","capture_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "proposals_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"question_findings": {
                  Row: {
                    "finding_id": string,"question_id": string,"workspace_id": string
                  }
                  Insert: {
                    "finding_id": string,"question_id": string,"workspace_id": string
                  }
                  Update: {
                    "finding_id"?: string,"question_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_findings_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "question_findings_workspace_id_question_id_fkey"
      columns: ["workspace_id","question_id"]
isOneToOne: false
      referencedRelation: "research_questions"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"research_experiments": {
                  Row: {
                    "budget_cap_usd": number | null,"budget_decision_id": string | null,"budget_stage1_usd": number | null,"campaign_id": string | null,"contact_email": string | null,"created_at": string,"id": string,"preview_token_hash": string | null,"privacy_notice": string | null,"publication_decision_id": string | null,"purpose": string | null,"responsible_name": string | null,"retention_days": number,"slug": string,"status": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "budget_cap_usd"?: number | null,"budget_decision_id"?: string | null,"budget_stage1_usd"?: number | null,"campaign_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"id"?: string,"preview_token_hash"?: string | null,"privacy_notice"?: string | null,"publication_decision_id"?: string | null,"purpose"?: string | null,"responsible_name"?: string | null,"retention_days"?: number,"slug": string,"status"?: string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "budget_cap_usd"?: number | null,"budget_decision_id"?: string | null,"budget_stage1_usd"?: number | null,"campaign_id"?: string | null,"contact_email"?: string | null,"created_at"?: string,"id"?: string,"preview_token_hash"?: string | null,"privacy_notice"?: string | null,"publication_decision_id"?: string | null,"purpose"?: string | null,"responsible_name"?: string | null,"retention_days"?: number,"slug"?: string,"status"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_experiments_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"research_questions": {
                  Row: {
                    "code": string,"created_at": string,"dimension": string | null,"evidence_asked": string | null,"hypothesis_text": string | null,"id": string,"industry": string | null,"kind": string,"next_action": string | null,"origin": string,"owner_name": string | null,"question": string,"source_url": string | null,"status": string,"updated_at": string,"vertical_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"dimension"?: string | null,"evidence_asked"?: string | null,"hypothesis_text"?: string | null,"id"?: string,"industry"?: string | null,"kind": string,"next_action"?: string | null,"origin"?: string,"owner_name"?: string | null,"question": string,"source_url"?: string | null,"status"?: string,"updated_at"?: string,"vertical_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"dimension"?: string | null,"evidence_asked"?: string | null,"hypothesis_text"?: string | null,"id"?: string,"industry"?: string | null,"kind"?: string,"next_action"?: string | null,"origin"?: string,"owner_name"?: string | null,"question"?: string,"source_url"?: string | null,"status"?: string,"updated_at"?: string,"vertical_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_questions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "research_questions_workspace_id_vertical_id_fkey"
      columns: ["workspace_id","vertical_id"]
isOneToOne: false
      referencedRelation: "verticals"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "captured_at": string,"created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"kind": string,"notes": string | null,"published_at": string | null,"publisher": string | null,"quality": string | null,"reference": string | null,"title": string,"updated_at": string,"url": string | null,"workspace_id": string
                  }
                  Insert: {
                    "captured_at"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind": string,"notes"?: string | null,"published_at"?: string | null,"publisher"?: string | null,"quality"?: string | null,"reference"?: string | null,"title": string,"updated_at"?: string,"url"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "captured_at"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"notes"?: string | null,"published_at"?: string | null,"publisher"?: string | null,"quality"?: string | null,"reference"?: string | null,"title"?: string,"updated_at"?: string,"url"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sources_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"survey_events": {
                  Row: {
                    "at": string,"id": number,"kind": string,"question": string | null,"session_id": string,"workspace_id": string
                  }
                  Insert: {
                    "at"?: string,"id"?: never,"kind": string,"question"?: string | null,"session_id": string,"workspace_id": string
                  }
                  Update: {
                    "at"?: string,"id"?: never,"kind"?: string,"question"?: string | null,"session_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "survey_events_workspace_id_session_id_fkey"
      columns: ["workspace_id","session_id"]
isOneToOne: false
      referencedRelation: "survey_sessions"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"survey_responses": {
                  Row: {
                    "answers": NonNullable<Json>,"answers_hash": string,"cohort": string,"created_at": string,"delete_after": string,"deletion_code": string,"duplicate_of": string | null,"eligible": boolean,"experiment_id": string,"id": string,"pii_detected": boolean,"review_note": string | null,"review_status": string,"reviewed_at": string | null,"reviewed_by": string | null,"session_id": string,"useful": boolean,"version_id": string,"workspace_id": string
                  }
                  Insert: {
                    "answers": NonNullable<Json>,"answers_hash": string,"cohort": string,"created_at"?: string,"delete_after": string,"deletion_code": string,"duplicate_of"?: string | null,"eligible": boolean,"experiment_id": string,"id"?: string,"pii_detected"?: boolean,"review_note"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"session_id": string,"useful": boolean,"version_id": string,"workspace_id": string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"answers_hash"?: string,"cohort"?: string,"created_at"?: string,"delete_after"?: string,"deletion_code"?: string,"duplicate_of"?: string | null,"eligible"?: boolean,"experiment_id"?: string,"id"?: string,"pii_detected"?: boolean,"review_note"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"session_id"?: string,"useful"?: boolean,"version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "survey_responses_workspace_id_experiment_id_fkey"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "survey_responses_workspace_id_session_id_fkey"
      columns: ["workspace_id","session_id"]
isOneToOne: false
      referencedRelation: "survey_sessions"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"survey_sessions": {
                  Row: {
                    "attribution": string,"cohort": string,"completed_at": string | null,"delete_after": string,"device": string | null,"experiment_id": string,"flagged": string | null,"id": string,"ip_hash_day": string | null,"landing_at": string,"last_question": string | null,"meta": NonNullable<Json>,"outcome": string | null,"quick_tap": string | null,"quick_tap_shown": boolean,"referrer_host": string | null,"started_at": string | null,"utm": NonNullable<Json>,"variant_code": string | null,"version_id": string,"workspace_id": string
                  }
                  Insert: {
                    "attribution"?: string,"cohort": string,"completed_at"?: string | null,"delete_after": string,"device"?: string | null,"experiment_id": string,"flagged"?: string | null,"id"?: string,"ip_hash_day"?: string | null,"landing_at"?: string,"last_question"?: string | null,"meta"?: NonNullable<Json>,"outcome"?: string | null,"quick_tap"?: string | null,"quick_tap_shown"?: boolean,"referrer_host"?: string | null,"started_at"?: string | null,"utm"?: NonNullable<Json>,"variant_code"?: string | null,"version_id": string,"workspace_id": string
                  }
                  Update: {
                    "attribution"?: string,"cohort"?: string,"completed_at"?: string | null,"delete_after"?: string,"device"?: string | null,"experiment_id"?: string,"flagged"?: string | null,"id"?: string,"ip_hash_day"?: string | null,"landing_at"?: string,"last_question"?: string | null,"meta"?: NonNullable<Json>,"outcome"?: string | null,"quick_tap"?: string | null,"quick_tap_shown"?: boolean,"referrer_host"?: string | null,"started_at"?: string | null,"utm"?: NonNullable<Json>,"variant_code"?: string | null,"version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "survey_sessions_workspace_id_experiment_id_fkey"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "survey_sessions_workspace_id_version_id_fkey"
      columns: ["workspace_id","version_id"]
isOneToOne: false
      referencedRelation: "survey_versions"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"survey_versions": {
                  Row: {
                    "created_at": string,"definition": NonNullable<Json>,"definition_sha": string,"experiment_id": string,"id": string,"version": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"definition": NonNullable<Json>,"definition_sha": string,"experiment_id": string,"id"?: string,"version": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"definition"?: NonNullable<Json>,"definition_sha"?: string,"experiment_id"?: string,"id"?: string,"version"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "survey_versions_workspace_id_experiment_id_fkey"
      columns: ["workspace_id","experiment_id"]
isOneToOne: false
      referencedRelation: "research_experiments"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"target_verticals": {
                  Row: {
                    "target_id": string,"vertical_id": string,"workspace_id": string
                  }
                  Insert: {
                    "target_id": string,"vertical_id": string,"workspace_id": string
                  }
                  Update: {
                    "target_id"?: string,"vertical_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "target_verticals_workspace_id_target_id_fkey"
      columns: ["workspace_id","target_id"]
isOneToOne: false
      referencedRelation: "campaign_targets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "target_verticals_workspace_id_vertical_id_fkey"
      columns: ["workspace_id","vertical_id"]
isOneToOne: false
      referencedRelation: "verticals"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "assignee_id": string | null,"channel": string | null,"completed_at": string | null,"contact_id": string | null,"created_at": string,"created_by": string | null,"description": string | null,"due_on": string | null,"finding_id": string | null,"id": string,"idempotency_key": string | null,"kind": string | null,"opportunity_id": string | null,"status": string,"target_id": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "assignee_id"?: string | null,"channel"?: string | null,"completed_at"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_on"?: string | null,"finding_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"kind"?: string | null,"opportunity_id"?: string | null,"status"?: string,"target_id"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "assignee_id"?: string | null,"channel"?: string | null,"completed_at"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_on"?: string | null,"finding_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"kind"?: string | null,"opportunity_id"?: string | null,"status"?: string,"target_id"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_contact_fk"
      columns: ["workspace_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "tasks_workspace_id_finding_id_fkey"
      columns: ["workspace_id","finding_id"]
isOneToOne: false
      referencedRelation: "findings"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "tasks_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_workspace_id_opportunity_id_fkey"
      columns: ["workspace_id","opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "tasks_workspace_id_target_id_fkey"
      columns: ["workspace_id","target_id"]
isOneToOne: false
      referencedRelation: "campaign_targets"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"transcripts": {
                  Row: {
                    "capture_id": string,"capture_media_id": string,"created_at": string,"created_by": string | null,"duration_ms": number | null,"error": string | null,"id": string,"language": string | null,"model": string,"provider": string,"status": string,"text": string | null,"utterances": NonNullable<Json>,"workspace_id": string
                  }
                  Insert: {
                    "capture_id": string,"capture_media_id": string,"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"error"?: string | null,"id"?: string,"language"?: string | null,"model": string,"provider": string,"status": string,"text"?: string | null,"utterances"?: NonNullable<Json>,"workspace_id": string
                  }
                  Update: {
                    "capture_id"?: string,"capture_media_id"?: string,"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"error"?: string | null,"id"?: string,"language"?: string | null,"model"?: string,"provider"?: string,"status"?: string,"text"?: string | null,"utterances"?: NonNullable<Json>,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transcripts_workspace_id_capture_id_fkey"
      columns: ["workspace_id","capture_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "transcripts_workspace_id_capture_media_id_fkey"
      columns: ["workspace_id","capture_media_id"]
isOneToOne: false
      referencedRelation: "capture_media"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "transcripts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"unresolved_entities": {
                  Row: {
                    "capture_id": string | null,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"kind": string,"label": string,"parent_id": string | null,"resolved_at": string | null,"resolved_by": string | null,"resolved_company_id": string | null,"resolved_contact_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "capture_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"kind": string,"label": string,"parent_id"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"resolved_company_id"?: string | null,"resolved_contact_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "capture_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"kind"?: string,"label"?: string,"parent_id"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"resolved_company_id"?: string | null,"resolved_contact_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "unresolved_entities_workspace_id_capture_id_fkey"
      columns: ["workspace_id","capture_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "unresolved_entities_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "unresolved_entities_workspace_id_parent_id_fkey"
      columns: ["workspace_id","parent_id"]
isOneToOne: false
      referencedRelation: "unresolved_entities"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "unresolved_entities_workspace_id_resolved_company_id_fkey"
      columns: ["workspace_id","resolved_company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "unresolved_entities_workspace_id_resolved_contact_id_fkey"
      columns: ["workspace_id","resolved_contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"user_preferences": {
                  Row: {
                    "home": NonNullable<Json>,"updated_at": string,"user_id": string,"workspace_id": string
                  }
                  Insert: {
                    "home"?: NonNullable<Json>,"updated_at"?: string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "home"?: NonNullable<Json>,"updated_at"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_preferences_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"verticals": {
                  Row: {
                    "code": string | null,"created_at": string,"created_by": string | null,"definition": string | null,"front": string | null,"id": string,"name": string,"owner_id": string | null,"problem_sought": string | null,"provisional": boolean,"status": string,"thesis": string | null,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "code"?: string | null,"created_at"?: string,"created_by"?: string | null,"definition"?: string | null,"front"?: string | null,"id"?: string,"name": string,"owner_id"?: string | null,"problem_sought"?: string | null,"provisional"?: boolean,"status"?: string,"thesis"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "code"?: string | null,"created_at"?: string,"created_by"?: string | null,"definition"?: string | null,"front"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string | null,"problem_sought"?: string | null,"provisional"?: boolean,"status"?: string,"thesis"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "verticals_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"visit_plans": {
                  Row: {
                    "campaign_id": string | null,"created_at": string,"created_by": string | null,"id": string,"notes": string | null,"owner_id": string | null,"planned_on": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notes"?: string | null,"owner_id"?: string | null,"planned_on": string,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "campaign_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notes"?: string | null,"owner_id"?: string | null,"planned_on"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_plans_workspace_id_campaign_id_fkey"
      columns: ["workspace_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "visit_plans_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"visit_stops": {
                  Row: {
                    "created_at": string,"id": string,"notes": string | null,"plan_id": string,"position": number,"status": string,"target_id": string,"target_time": string | null,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"notes"?: string | null,"plan_id": string,"position": number,"status"?: string,"target_id": string,"target_time"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"notes"?: string | null,"plan_id"?: string,"position"?: number,"status"?: string,"target_id"?: string,"target_time"?: string | null,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_stops_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_stops_workspace_id_plan_id_fkey"
      columns: ["workspace_id","plan_id"]
isOneToOne: false
      referencedRelation: "visit_plans"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "visit_stops_workspace_id_target_id_fkey"
      columns: ["workspace_id","target_id"]
isOneToOne: false
      referencedRelation: "campaign_targets"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"visits": {
                  Row: {
                    "consent_status": string,"contact_id": string | null,"created_at": string,"created_by": string | null,"id": string,"interlocutor_name": string | null,"is_demo": boolean,"notes": string,"stop_id": string | null,"target_id": string,"updated_at": string,"visited_at": string,"workspace_id": string
                  }
                  Insert: {
                    "consent_status"?: string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"interlocutor_name"?: string | null,"is_demo"?: boolean,"notes"?: string,"stop_id"?: string | null,"target_id": string,"updated_at"?: string,"visited_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "consent_status"?: string,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"interlocutor_name"?: string | null,"is_demo"?: boolean,"notes"?: string,"stop_id"?: string | null,"target_id"?: string,"updated_at"?: string,"visited_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visits_workspace_id_contact_id_fkey"
      columns: ["workspace_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "visits_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visits_workspace_id_stop_id_fkey"
      columns: ["workspace_id","stop_id"]
isOneToOne: false
      referencedRelation: "visit_stops"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "visits_workspace_id_target_id_fkey"
      columns: ["workspace_id","target_id"]
isOneToOne: false
      referencedRelation: "campaign_targets"
      referencedColumns: ["workspace_id","id"]
    }
                  ]
                },"workspace_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"can_approve_decisions": boolean,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"role": string,"status": string,"workspace_id": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"can_approve_decisions"?: boolean,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role": string,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"can_approve_decisions"?: boolean,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: string,"status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_invitations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"settings": NonNullable<Json>,"slug": string,"status": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"settings"?: NonNullable<Json>,"slug": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"settings"?: NonNullable<Json>,"slug"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_pending_invitations":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"can_approve":
{ Args: { "ws": string }; Returns: boolean
                           },
"can_edit":
{ Args: { "ws": string }; Returns: boolean
                           },
"claim_news_refresh":
{ Args: { "p_stale": string,"p_topic": string,"p_ws": string }; Returns: boolean
                           },
"create_capture":
{ Args: { "p": Json }; Returns: string
                           },
"decide_opportunity":
{ Args: { "p_decision": string,"p_note": string,"p_verdict": string }; Returns: undefined
                           },
"finish_news_refresh":
{ Args: { "p_ok": boolean,"p_topic": string,"p_ws": string }; Returns: undefined
                           },
"has_role":
{ Args: { "roles": (string)[],"ws": string }; Returns: boolean
                           },
"is_dealflow_stage":
{ Args: { "v": string }; Returns: boolean
                           },
"is_location_status":
{ Args: { "s": string }; Returns: boolean
                           },
"is_member":
{ Args: { "ws": string }; Returns: boolean
                           },
"is_research_admin":
{ Args: { "ws": string }; Returns: boolean
                           },
"is_verification_status":
{ Args: { "v": string }; Returns: boolean
                           },
"owns_conversation":
{ Args: { "conv": string }; Returns: boolean
                           },
"refine_finding":
{ Args: { "p_capture_id": string,"p_finding_id": string,"p_proposal_id": string,"p_reason": string,"p_relation": string,"p_statement": string }; Returns: undefined
                           },
"shares_workspace_with":
{ Args: { "other": string }; Returns: boolean
                           },
"storage_workspace":
{ Args: { "object_name": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const

