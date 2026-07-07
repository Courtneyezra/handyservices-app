-- Migration: Remap existing leads to the simplified 4-stage model.
-- Depends on 20260424_simple_stages.sql having already committed (the new
-- enum values must exist before they can be used in an UPDATE).
--
-- Mapping:
--   new_lead, contacted, awaiting_video, video_received         -> new
--   visit_scheduled, visit_done, quote_sent, quote_viewed,
--   awaiting_payment, in_progress                               -> pending
--   booked, completed                                           -> complete
--   lost, expired, declined                                     -> lost

UPDATE leads
SET
    stage = CASE stage
        WHEN 'new_lead' THEN 'new'
        WHEN 'contacted' THEN 'new'
        WHEN 'awaiting_video' THEN 'new'
        WHEN 'video_received' THEN 'new'
        WHEN 'visit_scheduled' THEN 'pending'
        WHEN 'visit_done' THEN 'pending'
        WHEN 'quote_sent' THEN 'pending'
        WHEN 'quote_viewed' THEN 'pending'
        WHEN 'awaiting_payment' THEN 'pending'
        WHEN 'in_progress' THEN 'pending'
        WHEN 'booked' THEN 'complete'
        WHEN 'completed' THEN 'complete'
        WHEN 'lost' THEN 'lost'
        WHEN 'expired' THEN 'lost'
        WHEN 'declined' THEN 'lost'
        ELSE stage
    END::lead_stage,
    stage_updated_at = NOW()
WHERE stage IN (
    'new_lead', 'contacted', 'awaiting_video', 'video_received',
    'visit_scheduled', 'visit_done', 'quote_sent', 'quote_viewed',
    'awaiting_payment', 'in_progress', 'booked', 'completed',
    'lost', 'expired', 'declined'
);
