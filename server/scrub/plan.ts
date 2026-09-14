/**
 * What the scrub does to each column, and the rule that says nothing is missed.
 *
 * The plan is not a list of tables somebody remembered. It is a classifier applied to the live
 * schema: the scrub reads `information_schema.columns`, asks this file about every column that
 * can hold text (text, varchar, char, their arrays, and json/jsonb), and REFUSES TO RUN if a
 * single one comes back unclassified. Adding a column to shared/schema.ts therefore forces a
 * decision here before the next scrub can run, and a column can never be forgotten quietly.
 *
 * Every column ends in exactly one of two places:
 *   a treatment  the value is rewritten to synthetic data of the same shape, and
 *   'keep'       the value is left alone because it is not about a person: an enumeration, a
 *                foreign key, a price, a catalogue entry, a Meta-approved template.
 *
 * 'keep' is not a promise that the column is clean, only that its *purpose* is not personal. The
 * belt for that is in sweep.ts: after the treatments run, every kept text column is swept for the
 * literal identifying strings the scrub collected before it started, so a customer's name sitting
 * in a column nobody classified as free text is still found and rewritten.
 */

export type Treatment =
    | 'person_name'        // "Dilys Hallam"
    | 'first_name'
    | 'last_name'
    | 'business_name'      // a trading name
    | 'phone'              // national or however it was stored, shape preserved
    | 'phone_e164'         // always +44...
    | 'phone_key'          // the `phone:<national>` key convention (server/clients.ts)
    | 'contact'            // a telephone number OR an e-mail address, decided per value, prefix kept
    | 'email'
    | 'address'            // one-line street address
    | 'address_line'       // just "12 Sherbrook Road"
    | 'postcode'
    | 'town'
    | 'latitude'
    | 'longitude'
    | 'coords_json'        // { lat, lng } in json
    | 'url'                // a media or document URL
    | 'url_list'           // an array or json array of them
    | 'data_url'           // an inline data: URL, usually a signature image
    | 'token'              // a bearer secret: session, app, calendar, invoice, review
    | 'password'           // a password hash
    | 'external_id'        // Stripe, Twilio, ElevenLabs and friends
    | 'message_body'       // one bubble or e-mail body in a thread
    | 'preview'            // a truncated last-message preview
    | 'narrative'          // what the job is: description, summary, proposal
    | 'note'               // an internal one-liner
    | 'transcript'         // a call transcript, several turns
    | 'json_deep'          // walk the json and treat the leaves by key name
    | 'session_blob'       // an express-session record
    | 'actor'              // a user id OR a person's name, decided per value
    | 'keep';

/** Column-name rules, tried in order. The first match wins; `null` means "ask the overrides". */
type Rule = [RegExp, Treatment];

/**
 * Ordered so that the specific beats the general: `stripe_customer_id` must reach the external-id
 * rule before the catch-all `*_id` rule sends it to `keep`.
 */
const RULES: Rule[] = [
    // ---- external references, before the id catch-all
    [/^(stripe|twilio|eleven_labs|meta|whatsapp)_.*(id|sid)$/, 'external_id'],
    [/^(content_sid|twilio_sid|call_id|eleven_labs_conversation_id)$/, 'external_id'],
    [/^(sip_address)$/, 'external_id'],
    [/^insurance_policy_number$/, 'external_id'],
    [/^insurance_claim_ref$/, 'external_id'],
    [/^invoice_number$/, 'keep'],

    // ---- secrets, before anything else can claim them
    [/^password$/, 'password'],
    [/(^|_)(token|secret)$/, 'token'],
    [/^(sid|auth|p256dh|endpoint|access_code)$/, 'token'],
    [/^sess$/, 'session_blob'],

    // ---- contact details
    [/(^|_)e164$/, 'phone_e164'],
    [/(^|_)phone_key$/, 'phone_key'],
    [/(^|_)(phone|phone_number|mobile|whatsapp_number)$/, 'phone'],
    [/^phones$/, 'json_deep'],
    [/(^|_)(email|email_address)$/, 'email'],
    [/^emails$/, 'json_deep'],

    // ---- where the job is
    [/(^|_)postcode$/, 'postcode'],
    [/^(town|city)$/, 'town'],
    [/^address_line_[12]$/, 'address_line'],
    [/(^|_)address$/, 'address'],
    [/^address_(raw|canonical)$/, 'address'],
    [/^latitude$/, 'latitude'],
    [/^longitude$/, 'longitude'],
    [/^coordinates$/, 'coords_json'],

    // ---- who the person is
    [/^(customer|contact|client|contractor|sender|lead|tenant|entered_by|created_by|matched_contractor)_name$/, 'person_name'],
    [/^(customer_)?full_name$/, 'person_name'],
    [/^(customer_)?first_name$/, 'first_name'],
    [/^(customer_)?last_name$/, 'last_name'],

    // ---- media and documents
    [/(^|_)(recording_url|media_url|receipt_url|pdf_url|video_url|thumbnail_url|image_url|hero_image_url|profile_image_url|intro_video_url)$/, 'url'],
    [/(^|_)(certificate_url|document_url)$/, 'url'],
    [/^local_recording_path$/, 'url'],
    [/(^|_)(urls|photos|photo_urls|media_urls|evidence_urls)$/, 'url_list'],
    [/(^|_)signature(_data)?_url$/, 'data_url'],
    // Late catch-all: every URL column whose purpose is a business link is overridden to 'keep'
    // below, so anything still reaching here points at a customer's or contractor's own file.
    [/(^|_)url$/, 'url'],

    // ---- free text whose purpose is to carry what a person said or wants
    [/(^|_)(transcription|transcript)$/, 'transcript'],
    [/^transcript_json$/, 'transcript'],
    [/^last_message_preview$/, 'preview'],
    [/^(body|content|final_body|original_body|proposed_body)$/, 'message_body'],
    [/(^|_)(job_description|job_summary|issue_description|customer_description|proposal_summary|job_top_line|description)$/, 'narrative'],
    [/^(summary|eleven_labs_summary|qualification_notes|cover_note|current_situation)$/, 'narrative'],
    [/(^|_)notes$/, 'note'],
    [/^(note|detail|feedback|message|review_text|contractor_response|response_message|warning)$/, 'note'],
    [/^(access_instructions|parking_notes|tenant_availability|voice_notes|special_equipment_needed)$/, 'note'],
    [/^(question|answer|context)$/, 'note'],
    [/^(trigger_text|matched_keyword|input_text)$/, 'note'],

    // ---- json that may hold any of the above at a leaf
    [/^(meta|metadata|usage|proposal|options|value|detail|segments|classification)$/, 'json_deep'],

    // ---- the catch-alls, last
    [/(^|_)id$/, 'keep'],
    [/(^|_)ids$/, 'keep'],
];

/**
 * Per-column decisions the name rules get wrong, and the ones that need saying out loud. Keyed
 * `table.column`. An entry here always beats a rule.
 */
const OVERRIDES: Record<string, Treatment> = {
    // --- the operator's own catalogue and site content: about the business, never about a customer
    'productized_services.name': 'keep',
    'productized_services.description': 'keep',
    'productized_services.ai_prompt_hint': 'keep',
    'productized_services.keywords': 'keep',
    'productized_services.negative_keywords': 'keep',
    'productized_services.sku_code': 'keep',
    'productized_services.category': 'keep',
    'productized_services.embedding_vector': 'keep',
    'service_catalog.name': 'keep',
    'service_catalog.admin_description': 'keep',
    'service_catalog.customer_description': 'keep',
    'service_catalog.ai_prompt_hint': 'keep',
    'service_catalog.keywords': 'keep',
    'service_catalog.negative_keywords': 'keep',
    'service_catalog.sku_code': 'keep',
    'service_catalog.category': 'keep',
    'service_catalog.icon': 'keep',
    'service_catalog.shape': 'keep',
    'service_catalog.tiers': 'keep',
    'service_catalog.unit_label': 'keep',
    'service_catalog.upsell_sku_codes': 'keep',
    'materials_catalog.name': 'keep',
    'materials_catalog.description': 'keep',
    'materials_catalog.brand': 'keep',
    'materials_catalog.category': 'keep',
    'materials_catalog.currency': 'keep',
    'materials_catalog.supplier': 'keep',
    'materials_catalog.supplier_item_number': 'keep',
    'materials_catalog.supplier_url': 'keep',
    'materials_catalog.image_url': 'keep',
    'quote_extras_catalog.description': 'keep',
    'quote_extras_catalog.label': 'keep',
    'quote_extras_catalog.badge': 'keep',
    'quote_extras_catalog.relevant_categories': 'keep',
    'wtbp_rate_card.notes': 'keep',
    'wtbp_rate_card.category_slug': 'keep',
    'wtbp_rate_card.rate_type': 'keep',
    'diy_advice.name': 'keep',
    'diy_advice.description_patterns': 'keep',
    'diy_advice.keywords': 'keep',
    'diy_advice.steps': 'keep',
    'diy_advice.tools_needed': 'keep',
    'diy_advice.warning': 'keep',
    'unsafe_patterns.pattern': 'keep',
    'unsafe_patterns.warning_message': 'keep',
    'training_modules.title': 'keep',
    'training_modules.description': 'keep',
    'training_modules.slug': 'keep',
    'training_modules.quiz_questions': 'keep',
    'training_modules.thumbnail_url': 'keep',
    'training_modules.video_url': 'keep',
    'landing_pages.name': 'keep',
    'landing_pages.slug': 'keep',
    'landing_pages.optimization_mode': 'keep',
    'landing_page_variants.name': 'keep',
    'landing_page_variants.content': 'keep',
    'banners.content': 'keep',
    'banners.link_url': 'keep',
    'banners.location': 'keep',
    'content_claims.text': 'keep',
    'content_claims.category': 'keep',
    'content_claims.job_categories': 'keep',
    'content_claims.signals': 'keep',
    'content_guarantees.title': 'keep',
    'content_guarantees.description': 'keep',
    'content_guarantees.badges': 'keep',
    'content_guarantees.items': 'keep',
    'content_guarantees.job_categories': 'keep',
    'content_guarantees.signals': 'keep',
    'content_hassle_items.with_us': 'keep',
    'content_hassle_items.without_us': 'keep',
    'content_hassle_items.job_categories': 'keep',
    'content_hassle_items.signals': 'keep',
    'content_booking_rules.name': 'keep',
    'content_booking_rules.booking_modes': 'keep',
    'content_booking_rules.conditions': 'keep',
    'content_images.alt': 'keep',
    'content_images.url': 'keep',
    'content_images.placement': 'keep',
    'content_images.job_categories': 'keep',
    'quote_platform_images.alt_text': 'keep',
    'quote_platform_images.url': 'keep',
    'quote_platform_images.filename': 'keep',
    'quote_platform_images.archetypes': 'keep',
    'quote_platform_images.gender_cue': 'keep',
    'quote_platform_images.job_types': 'keep',
    'quote_platform_headlines.text': 'keep',
    'quote_platform_headlines.customer_type': 'keep',
    'quote_platform_headlines.section': 'keep',

    // --- testimonials and reviews ARE real customers saying real things under their own names
    'content_testimonials.author': 'person_name',
    'content_testimonials.location': 'town',
    'content_testimonials.text': 'note',
    'content_testimonials.source': 'keep',
    'content_testimonials.job_categories': 'keep',
    'quote_platform_testimonials.author': 'person_name',
    'quote_platform_testimonials.location': 'town',
    'quote_platform_testimonials.text': 'note',
    'quote_platform_testimonials.archetype': 'keep',
    'quote_platform_testimonials.source': 'keep',
    'handyman_profiles.reviews': 'json_deep',

    // --- Meta-approved template text is the business's own, and its wording is fixed by Meta
    'whatsapp_templates.body': 'keep',
    'whatsapp_templates.name': 'keep',
    'whatsapp_templates.category': 'keep',
    'whatsapp_templates.language': 'keep',
    'whatsapp_templates.status': 'keep',
    'whatsapp_templates.rejection_reason': 'keep',
    'whatsapp_templates.variables': 'keep',
    'whatsapp_template_events.name': 'keep',
    'whatsapp_template_events.reason': 'keep',
    'whatsapp_template_events.from_status': 'keep',
    'whatsapp_template_events.to_status': 'keep',
    'quick_replies.body': 'keep',
    'quick_replies.label': 'keep',
    'quick_replies.category': 'keep',
    'quick_replies.shortcut': 'keep',
    'quick_replies.content_variables': 'json_deep',

    // --- the knowledge base is Ben's reviewed facts about his own business, and the comms-v2
    //     scenarios read it by exact wording. Swept for stray identifiers, never regenerated.
    'kb_entries.ben_note': 'keep',
    'kb_entries.source_note': 'keep',
    'kb_entries.topic': 'keep',
    'kb_entries.kind': 'keep',
    'kb_entries.status': 'keep',
    'kb_entries.approved_words': 'keep',
    'kb_entries.banned_words': 'keep',

    // --- the new comms desk's case files (server/comms-v2/desk/case-file.ts). The row's own
    //     columns are keys and copies of the record's stage; `person_ids` are minted
    //     `person_<uuid>` ids, never a telephone number. The whole thread lives in `file`, and its
    //     leaves are classified by key through the entries below, which apply only inside this
    //     table because the table has no real column of those names.
    'comms_v2_case_files.file': 'json_deep',
    'comms_v2_case_files.name': 'person_name',          // a party's name
    'comms_v2_case_files.canonical': 'contact',         // `phone:<national>` or `email:<address>`
    'comms_v2_case_files.address': 'contact',           // a channel address: E.164 or an e-mail
    'comms_v2_case_files.location': 'postcode',         // the job's postcode, outward code or area
    'comms_v2_case_files.text': 'message_body',         // a bubble the desk sent
    'comms_v2_case_files.draft': 'message_body',        // a held reply
    'comms_v2_case_files.words': 'note',                // what the approver said releasing a hold
    'comms_v2_case_files.value': 'note',                // a fact's value: a postcode, access, the job
    'comms_v2_case_files.path': 'url',                  // a downloaded photo's local path
    'comms_v2_case_files.approver': 'actor',            // `human:<email or user id>` on a turn or send
    // `reason` and `why` are the desk's own words, and `subject` is also the ask ledger's
    // enumeration, which the desk reads back, so all three are kept and swept.

    // --- names the rules would miss
    'tenants.name': 'person_name',
    'contractor_teams.name': 'business_name',
    'contractor_teams.display_name': 'business_name',
    'contractor_teams.bio': 'narrative',
    'service_clients.display_name': 'person_name',
    'va_endpoints.display_name': 'person_name',
    'partner_enquiries.full_name': 'person_name',
    'client_references.client_name': 'person_name',
    'gmb_posts.google_name': 'keep',
    'handyman_profiles.business_name': 'business_name',
    'handyman_profiles.slug': 'token',
    'handyman_profiles.bio': 'narrative',
    'handyman_profiles.social_links': 'json_deep',
    'handyman_profiles.ai_rules': 'json_deep',
    'handyman_profiles.before_after_gallery': 'url_list',
    'handyman_profiles.media_gallery': 'url_list',
    'handyman_profiles.trust_badges': 'keep',
    'personalized_quotes.created_by_name': 'person_name',
    'job_material_expenses.entered_by_name': 'person_name',
    'contractor_job_links.contractor_name': 'person_name',
    'messages.sender_name': 'person_name',
    'job_dispatches.customer_full_name': 'person_name',
    'job_dispatches.customer_first_name': 'first_name',

    // --- addresses and places the rules would miss
    'properties.nickname': 'note',
    'service_properties.nickname': 'note',
    'service_properties.client_key': 'keep',
    'service_properties.dedupe_key': 'keep',
    'service_properties.place_id': 'keep',
    'service_clients.dedupe_key': 'keep',
    'leads.place_id': 'keep',
    'keyword_targets.city': 'keep',
    'gmb_metrics.location': 'keep',
    'gmb_posts.location': 'keep',

    // --- free text the rules would miss or would take too literally
    'calls.site_visit_reason': 'note',
    'calls.missed_reason': 'keep',
    'calls.job_summary': 'narrative',
    'calls.tags': 'keep',
    'calls.ai_score_json': 'json_deep',
    'calls.detected_skus_json': 'keep',
    'calls.manual_skus_json': 'keep',
    'calls.live_analysis_json': 'json_deep',
    'calls.metadata_json': 'json_deep',
    'conversations.tags': 'keep',
    'leads.red_flags': 'keep',
    'leads.segment_signals': 'keep',
    'live_call_sessions.captured_info': 'json_deep',
    'live_call_sessions.segment_signals': 'keep',
    'live_call_sessions.completed_stations': 'keep',
    'system_events.summary': 'note',
    'system_events.detail': 'json_deep',
    'nudge_queue.message': 'note',
    'partner_enquiries.message': 'note',
    'partner_enquiries.current_situation': 'note',
    'partner_enquiries.territory_interest': 'keep',
    'partner_enquiries.investment_budget': 'keep',
    'job_applications.cover_note': 'narrative',
    'job_applications.current_situation': 'narrative',
    'job_applications.assessment_notes': 'note',
    'job_applications.status_notes': 'note',
    'job_applications.trades': 'keep',
    'job_applications.years_experience': 'keep',
    'job_applications.source': 'keep',
    'agent_questions.question': 'note',
    'agent_questions.answer': 'note',
    'agent_questions.context': 'note',
    'agent_questions.options': 'json_deep',
    'agent_runs.transcript': 'json_deep',
    'agent_runs.proposal': 'json_deep',
    'agent_runs.usage': 'keep',
    'agent_runs.transcript_ref': 'keep',
    'agent_runs.case_file_ref': 'keep',
    'ops_messages.content': 'message_body',
    'ops_messages.transcript': 'json_deep',
    'ops_messages.usage': 'keep',
    'ops_sessions.title': 'note',
    'troubleshooting_sessions.collected_data': 'json_deep',
    'troubleshooting_sessions.step_history': 'json_deep',
    'troubleshooting_sessions.outcome_reason': 'keep',
    'tenant_issues.ai_suggestions': 'json_deep',
    'tenant_issues.additional_notes': 'note',
    'tenant_issues.dispatch_reason': 'keep',
    'tenant_issues.landlord_rejection_reason': 'note',
    'quote_research.research': 'json_deep',
    'quote_research.jobs': 'json_deep',
    'quote_estimates.job': 'json_deep',
    'quote_estimates.lines': 'json_deep',
    'job_packs.job': 'json_deep',
    'job_packs.lines': 'json_deep',
    'job_packs.required': 'json_deep',
    'job_packs.missing': 'keep',
    'job_packs.change_log': 'json_deep',
    'job_sheets.line_items': 'json_deep',
    'job_sheets.materials_checklist': 'json_deep',
    'job_sheets.customer_contact_preference': 'keep',
    'invoices.line_items': 'json_deep',
    'credit_notes.line_items': 'json_deep',
    'disputes.disputed_line_items': 'json_deep',
    'disputes.resolution_notes': 'note',
    'job_incidents.resolution': 'note',
    'variation_orders.materials_required': 'json_deep',
    'variation_orders.customer_approval_signature': 'data_url',
    'variation_orders.customer_approval_method': 'keep',
    'contractor_booking_requests.customer_access_notes': 'note',
    'contractor_booking_requests.customer_declined_signature_reason': 'note',
    'contractor_booking_requests.completion_notes': 'note',
    'contractor_booking_requests.decline_notes': 'note',
    'contractor_booking_requests.requested_slot': 'keep',
    'contractor_booking_requests.scheduled_dates': 'keep',
    'contractor_diary_items.slot': 'keep',
    'sku_match_logs.input_text': 'narrative',
    'comms_opt_outs.trigger_text': 'note',
    'comms_opt_outs.note': 'note',
    'comms_events.body': 'message_body',
    'comms_events.meta': 'json_deep',
    'comms_events.job_ref': 'keep',
    'comms_events.ref_table': 'keep',
    'first_contact_ack_log.body': 'message_body',
    'first_contact_ack_log.detail': 'note',
    'first_contact_ack_log.template_name': 'keep',
    'message_drafts.content_variables': 'json_deep',
    'message_drafts.held_reason': 'keep',
    'message_drafts.error': 'keep',
    'draft_verdicts.reason': 'note',
    'quote_price_verdicts.meta': 'json_deep',
    'pack_tier_events.evidence': 'json_deep',
    'quote_offer_decisions.inputs': 'json_deep',
    'quote_offer_decisions.rationale': 'keep',
    'quote_offer_decisions.shadow_rationale': 'keep',
    'rank_snapshots.raw_meta': 'keep',
    'rank_snapshots.url': 'keep',
    'rank_snapshots.ranked_feature': 'keep',
    'seo_lead_attributions.landing_url': 'keep',
    'seo_lead_attributions.raw_keyword': 'keep',
    'keyword_targets.notes': 'keep',
    'keyword_targets.target_url': 'keep',
    'keyword_targets.keyword': 'keep',
    'keyword_targets.trade': 'keep',
    'keyword_targets.source': 'keep',
    'gmb_posts.summary': 'keep',
    'gmb_posts.cta_url': 'keep',
    'gmb_posts.media_url': 'keep',
    'gmb_posts.search_url': 'keep',
    'gmb_posts.theme_detail': 'keep',
    'gmb_posts.error': 'keep',
    'eval_runs.families': 'keep',
    'eval_runs.prompt_hashes': 'keep',
    'eval_runs.adapters': 'keep',
    'app_settings.description': 'keep',
    'app_settings.value': 'json_deep',
    'app_settings.key': 'keep',
    'master_blocked_dates.reason': 'keep',
    'contractor_availability_dates.notes': 'note',
    'contractor_commitments.notes': 'note',
    'assignment_proposals.note': 'note',
    'assignment_proposals.scheduled_dates': 'keep',
    'booking_slot_locks.scheduled_dates': 'keep',
    'expenses.description': 'note',
    'expenses.receipt_url': 'url',
    'job_material_expenses.description': 'note',
    'job_material_expenses.vendor': 'keep',
    'job_material_expenses.external_ref': 'keep',
    'job_material_expenses.spend_date': 'keep',
    'partner_applications.admin_notes': 'note',
    'partner_applications.highvis_size': 'keep',
    'client_references.feedback': 'note',
    'client_references.job_description': 'narrative',
    'contractor_reviews.review_text': 'note',
    'contractor_reviews.contractor_response': 'note',
    'customer_rewards.code': 'keep',
    'customer_rewards.prize_title': 'keep',
    'push_subscriptions.user_agent': 'keep',
    'v2_bookings.reference': 'keep',
    'v2_bookings.slot_label': 'keep',
    'v2_bookings.slot_date': 'keep',
    'v2_bookings.services': 'json_deep',
    'v2_bookings.notes': 'note',
    'v2_bookings.variant': 'keep',
    'va_call_tasks.reason': 'keep',
    'va_call_tasks.dismiss_reason': 'note',
    'sla_alerts.resolve_reason': 'note',
    'dispatch_variations.admin_notes': 'note',
    'dispatch_variations.reason': 'note',
    'dispatch_bonds.forfeit_reason': 'note',
    'dispatch_bonds.refund_reason': 'note',
    'dispatch_completions.notes': 'note',
    'contractor_payouts.failure_reason': 'keep',
    'contractor_payouts.held_reason': 'keep',
    'contractor_payouts.reversal_reason': 'keep',
    'job_dispatches.subtitle': 'narrative',
    'job_dispatches.title': 'narrative',
    'job_dispatches.tasks': 'json_deep',
    'job_dispatches.preferred_dates': 'keep',
    'landlord_settings.emergency_contact_phone': 'phone',
    'landlord_settings.always_require_approval_categories': 'keep',
    'landlord_settings.auto_approve_categories': 'keep',
    'landlord_settings.preferred_channel': 'keep',
    'availability_slots.slot_type': 'keep',
    'availability_slots.start_time': 'keep',
    'availability_slots.end_time': 'keep',
    'deflection_metrics.issue_category': 'keep',
    'deflection_metrics.deflection_type': 'keep',
    'pack_intent_tiers.reason': 'keep',
    'pack_tier_events.reason': 'keep',
    'sessions.sid': 'token',

    // --- the quote page: mostly generated marketing copy, but it is generated ABOUT one customer
    'personalized_quotes.additional_notes': 'note',
    'personalized_quotes.assessment_reason': 'note',
    'personalized_quotes.contextual_headline': 'note',
    'personalized_quotes.contextual_message': 'note',
    'personalized_quotes.whatsapp_closing': 'note',
    'personalized_quotes.whatsapp_value_lines': 'json_deep',
    'personalized_quotes.proposal_summary': 'narrative',
    'personalized_quotes.job_description': 'narrative',
    'personalized_quotes.job_top_line': 'narrative',
    'personalized_quotes.jobs': 'json_deep',
    'personalized_quotes.tasks': 'json_deep',
    'personalized_quotes.quote_assumptions': 'json_deep',
    'personalized_quotes.pricing_line_items': 'json_deep',
    'personalized_quotes.deferred_line_items': 'json_deep',
    'personalized_quotes.core_deliverables': 'json_deep',
    'personalized_quotes.tier_deliverables': 'json_deep',
    'personalized_quotes.personalized_features': 'json_deep',
    'personalized_quotes.value_bullets': 'json_deep',
    'personalized_quotes.value_opportunities': 'json_deep',
    'personalized_quotes.potential_extras': 'json_deep',
    'personalized_quotes.potential_upgrades': 'json_deep',
    'personalized_quotes.optional_extras': 'json_deep',
    'personalized_quotes.selected_extras': 'json_deep',
    'personalized_quotes.desirables': 'json_deep',
    'personalized_quotes.hire_equipment': 'json_deep',
    'personalized_quotes.survey_response': 'json_deep',
    'personalized_quotes.feedback_json': 'json_deep',
    'personalized_quotes.team_plan': 'json_deep',
    'personalized_quotes.slot_offer': 'json_deep',
    'personalized_quotes.context_signals': 'keep',
    'personalized_quotes.match_flags': 'keep',
    'personalized_quotes.margin_flags': 'keep',
    'personalized_quotes.per_line_margin': 'keep',
    'personalized_quotes.pricing_layer_breakdown': 'keep',
    'personalized_quotes.pricing_snapshot': 'keep',
    'personalized_quotes.pricing_suggestions': 'keep',
    'personalized_quotes.available_dates': 'keep',
    'personalized_quotes.date_time_preferences': 'keep',
    'personalized_quotes.booking_modes': 'keep',
    'personalized_quotes.categories': 'keep',
    'personalized_quotes.uncovered_categories': 'keep',
    'personalized_quotes.substrates': 'keep',
    'personalized_quotes.customer_photo_urls': 'url_list',
    'personalized_quotes.customer_video_urls': 'url_list',
    'personalized_quotes.short_slug': 'keep',
    'personalized_quotes.completion_date': 'keep',
    'personalized_quotes.desired_timeframe': 'keep',
    'personalized_quotes.exact_time_requested': 'keep',
    'personalized_quotes.refund_reason': 'keep',
    'personalized_quotes.rejection_reason': 'keep',
    'personalized_quotes.review_reason': 'keep',
    'personalized_quotes.urgency_reason': 'keep',
    'personalized_quotes.lead_contractor_source': 'keep',
    'personalized_quotes.materials_by': 'keep',
    'personalized_quotes.emotional_angle': 'keep',
    'personalized_quotes.ownership_context': 'keep',
    'personalized_quotes.parking_distance_category': 'keep',
    'personalized_quotes.selected_package': 'keep',
    'personalized_quotes.selected_content_ids': 'keep',
    'personalized_quotes.candidate_contractor_ids': 'keep',
    'personalized_quotes.claimed_gift_id': 'keep',
};

/**
 * Column names that are enumerations, codes, hashes, timestamps-as-text, money or model
 * identifiers wherever they appear. Anything matching is kept, and the sweep in sweep.ts is the
 * belt that catches a real value hiding in one.
 */
const KEEP_NAMES = new Set([
    'status', 'state', 'stage', 'kind', 'type', 'mode', 'role', 'direction', 'channel', 'source',
    'verdict', 'decision', 'shadow_decision', 'tier', 'from_tier', 'to_tier', 'priority', 'urgency',
    'category', 'categories', 'segment', 'persona', 'lane', 'agent', 'capability', 'intent',
    'method', 'match_method', 'detection_method', 'sku_detection_method', 'currency', 'language',
    'model', 'model_snapshot', 'shadow_model', 'prompt_hash', 'guards_hit', 'trigger', 'error',
    'error_code', 'error_message', 'quarantine_reason', 'reason', 'decline_reason', 'action_status',
    'outcome', 'event', 'event_type', 'moment', 'goal', 'rule_fired', 'served_play', 'shadow_play',
    'target_play', 'shadow_stakes', 'slug', 'quote_slug', 'short_slug', 'short_code', 'code',
    'label', 'title', 'name', 'description', 'text', 'location', 'topic', 'theme', 'device_type',
    'customer_type', 'client_type', 'crew_type', 'lead_type', 'payment_type', 'payment_method',
    'payment_status', 'offer_type', 'template', 'confidence', 'proficiency', 'vertical',
    'availability_status', 'verification_status', 'partner_status', 'identity_status',
    'insurance_status', 'training_status', 'references_status', 'assignment_status',
    'delivery_status', 'delivery_channel', 'delivery_tier', 'subscription_tier', 'installment_status',
    'send_status', 'contact_class', 'role_profile', 'scope', 'match_rule', 'quotability',
    'layout_tier', 'scheduling_tier', 'visit_tier_mode', 'quote_mode', 'source_channel',
    'source_type', 'dominant_category', 'job_type', 'job_types', 'vehicle_type', 'time_slot_type',
    'offered_via', 'covered_categories', 'warnings_acknowledged', 'dispatch_decision',
    'archetype', 'archetypes', 'section', 'gender_cue', 'unit_label', 'topic_type', 'cta_type',
    'start_time', 'end_time', 'scheduled_time', 'scheduled_start_time', 'scheduled_end_time',
    'current_station', 'detected_segment', 'recommended_destination', 'selected_destination',
    'current_step_id', 'git_ref', 'run_id', 'parent_run_id', 'intake_run_id', 'agent_run',
    'lever', 'balance_invoice_status', 'balance_invoice_last_error', 'stripe_account_status',
    'stripe_transfer_status', 'requested_slot', 'scheduled_dates', 'category_slug', 'media_type',
    'recommended_tier', 'superseded_by', 'embedding', 'tags',
]);

/** Actor columns: the value is a user id, a `human:<id>` handle, or occasionally a typed name. */
const ACTOR_NAMES = new Set([
    'by', 'actor', 'answered_by', 'approved_by', 'decided_by', 'drafted_by', 'edited_by', 'sent_by',
    'handled_by', 'created_by', 'assigned_to', 'changed_by', 'dismissed_by', 'revoked_by',
    'last_edited_by', 'scored_by', 'entered_by', 'forfeited_by', 'admin_approved_by', 'resolved_by',
    'issued_by', 'escalated_to', 'reviewed_by', 'added_by',
]);

/**
 * Postgres types that can hold free text, and therefore have to be classified. A column whose
 * type is a Postgres enum is excluded by introspect.ts before it reaches here: an enum can only
 * ever hold one of its declared labels, so it is structurally incapable of holding a name. Every
 * other `USER-DEFINED` type still has to be classified.
 */
export const TEXTUAL_TYPES = new Set([
    'text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY', 'USER-DEFINED',
]);

/**
 * Decide what happens to one column, or return null when nothing in this file covers it — which
 * is the signal for the scrub to stop and make somebody choose.
 */
export function classify(table: string, column: string): Treatment | null {
    const override = OVERRIDES[`${table}.${column}`];
    if (override) return override;
    if (ACTOR_NAMES.has(column)) return 'actor';
    for (const [re, treatment] of RULES) if (re.test(column)) return treatment;
    if (KEEP_NAMES.has(column)) return 'keep';
    return null;
}

/** Treatments that replace the whole value, so the later sweep has nothing left to find there. */
export const REGENERATING_TREATMENTS: ReadonlySet<Treatment> = new Set<Treatment>([
    'person_name', 'first_name', 'last_name', 'business_name', 'phone', 'phone_e164', 'phone_key',
    'contact', 'email', 'address', 'address_line', 'postcode', 'town', 'latitude', 'longitude', 'coords_json',
    'url', 'url_list', 'data_url', 'token', 'password', 'external_id', 'message_body', 'preview',
    'narrative', 'note', 'transcript', 'session_blob',
]);
