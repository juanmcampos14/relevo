
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
            "ai_action_drafts": {
                  Row: {
                    "action": string,"conversation_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"error": string | null,"evidence_refs": NonNullable<Json>,"id": string,"message_id": string | null,"payload": NonNullable<Json>,"rationale": string | null,"result_ref": string | null,"status": string,"workspace_id": string
                  }
                  Insert: {
                    "action": string,"conversation_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"error"?: string | null,"evidence_refs"?: NonNullable<Json>,"id"?: string,"message_id"?: string | null,"payload": NonNullable<Json>,"rationale"?: string | null,"result_ref"?: string | null,"status"?: string,"workspace_id": string
                  }
                  Update: {
                    "action"?: string,"conversation_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"error"?: string | null,"evidence_refs"?: NonNullable<Json>,"id"?: string,"message_id"?: string | null,"payload"?: NonNullable<Json>,"rationale"?: string | null,"result_ref"?: string | null,"status"?: string,"workspace_id"?: string
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
                },"assets": {
                  Row: {
                    "address_status": string,"address_text": string | null,"country": string | null,"created_at": string,"created_by": string | null,"establishment_id": string | null,"id": string,"is_demo": boolean,"kind": string,"latitude": number | null,"locality": string | null,"location_source_id": string | null,"location_verified_at": string | null,"longitude": number | null,"notes": string | null,"operation": string,"owner_company_id": string | null,"price_amount": number | null,"price_currency": string | null,"price_observed_on": string | null,"price_source_id": string | null,"province": string | null,"source_id": string | null,"surface_m2": number | null,"title": string,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "address_status"?: string,"address_text"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"establishment_id"?: string | null,"id"?: string,"is_demo"?: boolean,"kind": string,"latitude"?: number | null,"locality"?: string | null,"location_source_id"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"notes"?: string | null,"operation"?: string,"owner_company_id"?: string | null,"price_amount"?: number | null,"price_currency"?: string | null,"price_observed_on"?: string | null,"price_source_id"?: string | null,"province"?: string | null,"source_id"?: string | null,"surface_m2"?: number | null,"title": string,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "address_status"?: string,"address_text"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"establishment_id"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"latitude"?: number | null,"locality"?: string | null,"location_source_id"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"notes"?: string | null,"operation"?: string,"owner_company_id"?: string | null,"price_amount"?: number | null,"price_currency"?: string | null,"price_observed_on"?: string | null,"price_source_id"?: string | null,"province"?: string | null,"source_id"?: string | null,"surface_m2"?: number | null,"title"?: string,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
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
      foreignKeyName: "assets_workspace_id_owner_company_id_fkey"
      columns: ["workspace_id","owner_company_id"]
isOneToOne: false
      referencedRelation: "companies"
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
                    "created_at": string,"created_by": string | null,"ends_on": string | null,"id": string,"name": string,"objective": string | null,"owner_id": string | null,"starts_on": string | null,"status": string,"updated_at": string,"workspace_id": string,"zone": string | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"name": string,"objective"?: string | null,"owner_id"?: string | null,"starts_on"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id": string,"zone"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"name"?: string,"objective"?: string | null,"owner_id"?: string | null,"starts_on"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string,"zone"?: string | null
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
                },"claims": {
                  Row: {
                    "asset_id": string | null,"company_id": string | null,"contact_id": string | null,"created_at": string,"created_by": string | null,"establishment_id": string | null,"id": string,"next_verification_step": string | null,"source_id": string | null,"statement": string,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "asset_id"?: string | null,"company_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"establishment_id"?: string | null,"id"?: string,"next_verification_step"?: string | null,"source_id"?: string | null,"statement": string,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "asset_id"?: string | null,"company_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"establishment_id"?: string | null,"id"?: string,"next_verification_step"?: string | null,"source_id"?: string | null,"statement"?: string,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "claims_workspace_id_asset_id_fkey"
      columns: ["workspace_id","asset_id"]
isOneToOne: false
      referencedRelation: "assets"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "claims_workspace_id_company_id_fkey"
      columns: ["workspace_id","company_id"]
isOneToOne: false
      referencedRelation: "companies"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "claims_workspace_id_contact_id_fkey"
      columns: ["workspace_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "claims_workspace_id_establishment_id_fkey"
      columns: ["workspace_id","establishment_id"]
isOneToOne: false
      referencedRelation: "establishments"
      referencedColumns: ["workspace_id","id"]
    },{
      foreignKeyName: "claims_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "claims_workspace_id_source_id_fkey"
      columns: ["workspace_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["workspace_id","id"]
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
                    "created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"kind": string,"legal_name": string | null,"locality": string | null,"notes": string | null,"source_id": string | null,"trade_name": string | null,"updated_at": string,"verification_status": string,"website": string | null,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"legal_name"?: string | null,"locality"?: string | null,"notes"?: string | null,"source_id"?: string | null,"trade_name"?: string | null,"updated_at"?: string,"verification_status"?: string,"website"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"legal_name"?: string | null,"locality"?: string | null,"notes"?: string | null,"source_id"?: string | null,"trade_name"?: string | null,"updated_at"?: string,"verification_status"?: string,"website"?: string | null,"workspace_id"?: string
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
                    "contact_permission": string,"created_at": string,"created_by": string | null,"email": string | null,"full_name": string,"id": string,"introduced_by": string | null,"is_demo": boolean,"notes": string | null,"phone": string | null,"preferred_channel": string | null,"role_title": string | null,"source_id": string | null,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "contact_permission"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"full_name": string,"id"?: string,"introduced_by"?: string | null,"is_demo"?: boolean,"notes"?: string | null,"phone"?: string | null,"preferred_channel"?: string | null,"role_title"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "contact_permission"?: string,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"full_name"?: string,"id"?: string,"introduced_by"?: string | null,"is_demo"?: boolean,"notes"?: string | null,"phone"?: string | null,"preferred_channel"?: string | null,"role_title"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
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
                },"decisions": {
                  Row: {
                    "context": string | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"due_on": string | null,"id": string,"kind": string,"opportunity_id": string | null,"question": string,"requested_by": string | null,"status": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "context"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"due_on"?: string | null,"id"?: string,"kind"?: string,"opportunity_id"?: string | null,"question": string,"requested_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "context"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"due_on"?: string | null,"id"?: string,"kind"?: string,"opportunity_id"?: string | null,"question"?: string,"requested_by"?: string | null,"status"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
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
                    "address_status": string,"address_text": string | null,"company_id": string | null,"country": string | null,"created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"latitude": number | null,"locality": string | null,"location_source_id": string | null,"location_verified_at": string | null,"longitude": number | null,"name": string,"notes": string | null,"province": string | null,"source_id": string | null,"updated_at": string,"verification_status": string,"workspace_id": string
                  }
                  Insert: {
                    "address_status"?: string,"address_text"?: string | null,"company_id"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"latitude"?: number | null,"locality"?: string | null,"location_source_id"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"name": string,"notes"?: string | null,"province"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id": string
                  }
                  Update: {
                    "address_status"?: string,"address_text"?: string | null,"company_id"?: string | null,"country"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"latitude"?: number | null,"locality"?: string | null,"location_source_id"?: string | null,"location_verified_at"?: string | null,"longitude"?: number | null,"name"?: string,"notes"?: string | null,"province"?: string | null,"source_id"?: string | null,"updated_at"?: string,"verification_status"?: string,"workspace_id"?: string
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
                },"findings": {
                  Row: {
                    "analysis": string | null,"asset_id": string | null,"campaign_id": string | null,"company_id": string | null,"created_at": string,"created_by": string | null,"dedup_key": string | null,"establishment_id": string | null,"evidence": string | null,"id": string,"ingest_meta": Json | null,"ingest_token_id": string | null,"kind": string,"origin": string,"review_note": string | null,"review_status": string,"reviewed_at": string | null,"reviewed_by": string | null,"source_id": string,"statement": string,"updated_at": string,"verification_status": string,"vertical_id": string | null,"visit_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "analysis"?: string | null,"asset_id"?: string | null,"campaign_id"?: string | null,"company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"dedup_key"?: string | null,"establishment_id"?: string | null,"evidence"?: string | null,"id"?: string,"ingest_meta"?: Json | null,"ingest_token_id"?: string | null,"kind": string,"origin"?: string,"review_note"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source_id": string,"statement": string,"updated_at"?: string,"verification_status"?: string,"vertical_id"?: string | null,"visit_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "analysis"?: string | null,"asset_id"?: string | null,"campaign_id"?: string | null,"company_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"dedup_key"?: string | null,"establishment_id"?: string | null,"evidence"?: string | null,"id"?: string,"ingest_meta"?: Json | null,"ingest_token_id"?: string | null,"kind"?: string,"origin"?: string,"review_note"?: string | null,"review_status"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source_id"?: string,"statement"?: string,"updated_at"?: string,"verification_status"?: string,"vertical_id"?: string | null,"visit_id"?: string | null,"workspace_id"?: string
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
                },"sources": {
                  Row: {
                    "captured_at": string,"created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"kind": string,"notes": string | null,"published_at": string | null,"publisher": string | null,"reference": string | null,"title": string,"updated_at": string,"url": string | null,"workspace_id": string
                  }
                  Insert: {
                    "captured_at"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind": string,"notes"?: string | null,"published_at"?: string | null,"publisher"?: string | null,"reference"?: string | null,"title": string,"updated_at"?: string,"url"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "captured_at"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"kind"?: string,"notes"?: string | null,"published_at"?: string | null,"publisher"?: string | null,"reference"?: string | null,"title"?: string,"updated_at"?: string,"url"?: string | null,"workspace_id"?: string
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
                    "assignee_id": string | null,"completed_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"due_on": string | null,"finding_id": string | null,"id": string,"idempotency_key": string | null,"opportunity_id": string | null,"status": string,"target_id": string | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "assignee_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_on"?: string | null,"finding_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"opportunity_id"?: string | null,"status"?: string,"target_id"?: string | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "assignee_id"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_on"?: string | null,"finding_id"?: string | null,"id"?: string,"idempotency_key"?: string | null,"opportunity_id"?: string | null,"status"?: string,"target_id"?: string | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
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
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"owner_id": string | null,"problem_sought": string | null,"status": string,"thesis": string | null,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"owner_id"?: string | null,"problem_sought"?: string | null,"status"?: string,"thesis"?: string | null,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string | null,"problem_sought"?: string | null,"status"?: string,"thesis"?: string | null,"updated_at"?: string,"workspace_id"?: string
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
"decide_opportunity":
{ Args: { "p_decision": string,"p_note": string,"p_verdict": string }; Returns: undefined
                           },
"has_role":
{ Args: { "roles": (string)[],"ws": string }; Returns: boolean
                           },
"is_dealflow_stage":
{ Args: { "v": string }; Returns: boolean
                           },
"is_member":
{ Args: { "ws": string }; Returns: boolean
                           },
"is_verification_status":
{ Args: { "v": string }; Returns: boolean
                           },
"owns_conversation":
{ Args: { "conv": string }; Returns: boolean
                           },
"shares_workspace_with":
{ Args: { "other": string }; Returns: boolean
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

