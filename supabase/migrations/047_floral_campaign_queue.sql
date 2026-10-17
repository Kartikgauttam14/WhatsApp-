-- Durable, account-paced floral campaigns. No messages are sent by this migration.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.floral_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','paused','completed','cancelled')),
  template_name text NOT NULL DEFAULT 'mansam_floral_collection' CHECK (template_name = 'mansam_floral_collection'),
  template_language text NOT NULL,
  total_recipients integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, request_id)
);
CREATE TABLE IF NOT EXISTS public.floral_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.floral_campaigns(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name text,
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','delivered','read','failed','unknown','skipped')),
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  whatsapp_message_id text,
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone)
);
CREATE INDEX IF NOT EXISTS floral_campaign_pending ON public.floral_campaign_recipients(account_id, campaign_id, position) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS floral_campaign_message ON public.floral_campaign_recipients(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.floral_campaign_clocks (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  next_send_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.floral_campaign_worker (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  endpoint text NOT NULL,
  secret text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_tick_at timestamptz
);
INSERT INTO public.floral_campaign_worker(id, endpoint)
VALUES (true, 'https://whats-app-eight-sigma.vercel.app/api/floral-campaigns/tick')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.floral_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floral_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floral_campaign_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floral_campaign_worker ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS floral_campaign_read ON public.floral_campaigns;
CREATE POLICY floral_campaign_read ON public.floral_campaigns FOR SELECT TO authenticated USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS floral_recipient_read ON public.floral_campaign_recipients;
CREATE POLICY floral_recipient_read ON public.floral_campaign_recipients FOR SELECT TO authenticated USING (public.is_account_member(account_id));
GRANT SELECT ON public.floral_campaigns, public.floral_campaign_recipients TO authenticated;
GRANT ALL ON public.floral_campaigns, public.floral_campaign_recipients, public.floral_campaign_clocks, public.floral_campaign_worker TO service_role;
-- No client write policies. The worker secret and account clocks are service-only.

CREATE OR REPLACE VIEW public.floral_campaign_summaries WITH (security_invoker = true) AS
SELECT c.*,
  count(r.id) FILTER (WHERE r.status = 'pending')::integer AS pending_count,
  count(r.id) FILTER (WHERE r.status = 'sending')::integer AS sending_count,
  count(r.id) FILTER (WHERE r.status IN ('sent','delivered','read'))::integer AS sent_count,
  count(r.id) FILTER (WHERE r.status IN ('delivered','read'))::integer AS delivered_count,
  count(r.id) FILTER (WHERE r.status = 'read')::integer AS read_count,
  count(r.id) FILTER (WHERE r.status = 'failed')::integer AS failed_count,
  count(r.id) FILTER (WHERE r.status = 'unknown')::integer AS unknown_count,
  count(r.id) FILTER (WHERE r.status = 'skipped')::integer AS skipped_count
FROM public.floral_campaigns c LEFT JOIN public.floral_campaign_recipients r ON r.campaign_id = c.id
GROUP BY c.id;
GRANT SELECT ON public.floral_campaign_summaries TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_floral_campaign(p_account_id uuid, p_user_id uuid, p_request_id uuid, p_name text, p_recipients jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE campaign uuid; lang text; recipient_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_user_id AND account_id = p_account_id AND account_role IN ('owner','admin','agent')) THEN
    RAISE EXCEPTION 'Not allowed to create this campaign';
  END IF;
  -- Serializes duplicate submissions and creation with account-level controls.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text, 47));
  SELECT id INTO campaign FROM floral_campaigns WHERE account_id = p_account_id AND request_id = p_request_id;
  IF campaign IS NOT NULL THEN RETURN campaign; END IF;
  IF jsonb_typeof(p_recipients) <> 'array' OR jsonb_array_length(p_recipients) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Provide 1–1000 recipients'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_recipients) r WHERE coalesce(r->>'phone','') !~ '^\+[1-9][0-9]{7,14}$') THEN RAISE EXCEPTION 'Use international numbers with + and country code'; END IF;
  SELECT language INTO lang FROM message_templates WHERE account_id = p_account_id AND name = 'mansam_floral_collection' AND status = 'APPROVED'
    ORDER BY CASE WHEN language = 'en' THEN 0 ELSE 1 END, id LIMIT 1;
  IF lang IS NULL THEN RAISE EXCEPTION 'Approved floral template is not available'; END IF;
  SELECT count(DISTINCT r->>'phone') INTO recipient_count FROM jsonb_array_elements(p_recipients) r;
  INSERT INTO floral_campaigns(account_id,user_id,request_id,name,template_language,total_recipients)
    VALUES(p_account_id,p_user_id,p_request_id,left(coalesce(nullif(trim(p_name),''),'Floral fragrances campaign'),120),lang,recipient_count)
    RETURNING id INTO campaign;
  INSERT INTO floral_campaign_recipients(account_id,campaign_id,phone,name,position)
    SELECT p_account_id,campaign,phone,name,position FROM (
      SELECT DISTINCT ON (value->>'phone') value->>'phone' AS phone, left(value->>'name',120) AS name, ordinality::integer AS position
      FROM jsonb_array_elements(p_recipients) WITH ORDINALITY ORDER BY value->>'phone',ordinality
    ) unique_numbers;
  INSERT INTO floral_campaign_clocks(account_id) VALUES(p_account_id) ON CONFLICT DO NOTHING;
  RETURN campaign;
END; $$;

CREATE OR REPLACE FUNCTION public.claim_floral_campaign_recipient(p_account_id uuid)
RETURNS SETOF public.floral_campaign_recipients LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE due timestamptz; chosen_campaign uuid; chosen_recipient uuid;
BEGIN
  SELECT next_send_at INTO due FROM floral_campaign_clocks WHERE account_id = p_account_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR due > clock_timestamp() THEN RETURN; END IF;
  -- A crashed/uncertain send is never automatically retried.
  UPDATE floral_campaign_recipients SET status='unknown',error_message='Delivery was not confirmed. Not retried to prevent duplicates.',updated_at=now()
    WHERE account_id=p_account_id AND status='sending' AND claimed_at < now()-interval '5 minutes';
  UPDATE floral_campaigns c SET status='completed',updated_at=now() WHERE c.account_id=p_account_id AND c.status IN ('queued','running')
    AND NOT EXISTS (SELECT 1 FROM floral_campaign_recipients r WHERE r.campaign_id=c.id AND r.status IN ('pending','sending'));
  IF EXISTS (SELECT 1 FROM floral_campaign_recipients WHERE account_id=p_account_id AND status='sending') THEN RETURN; END IF;
  SELECT c.id INTO chosen_campaign FROM floral_campaigns c WHERE c.account_id=p_account_id AND c.status IN ('queued','running')
    AND EXISTS (SELECT 1 FROM floral_campaign_recipients r WHERE r.campaign_id=c.id AND r.status='pending')
    ORDER BY c.created_at,c.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF chosen_campaign IS NULL THEN RETURN; END IF;
  SELECT id INTO chosen_recipient FROM floral_campaign_recipients WHERE campaign_id=chosen_campaign AND status='pending' ORDER BY position,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF chosen_recipient IS NULL THEN RETURN; END IF;
  UPDATE floral_campaign_clocks SET next_send_at=clock_timestamp()+interval '60 seconds' WHERE account_id=p_account_id;
  UPDATE floral_campaigns SET status='running',updated_at=now() WHERE id=chosen_campaign;
  RETURN QUERY UPDATE floral_campaign_recipients SET status='sending',claim_id=gen_random_uuid(),claimed_at=now(),updated_at=now()
    WHERE id=chosen_recipient AND status='pending' RETURNING *;
END; $$;

CREATE OR REPLACE FUNCTION public.finish_floral_campaign_recipient(p_recipient_id uuid, p_claim_id uuid, p_status text, p_message_id text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recipient public.floral_campaign_recipients;
BEGIN
  IF p_status NOT IN ('sent','failed','unknown') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
  SELECT * INTO recipient FROM floral_campaign_recipients WHERE id=p_recipient_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  PERFORM 1 FROM floral_campaign_clocks WHERE account_id=recipient.account_id FOR UPDATE;
  UPDATE floral_campaign_recipients SET status=p_status,whatsapp_message_id=p_message_id,error_message=left(p_error,1000),
    sent_at=CASE WHEN p_status='sent' THEN now() ELSE NULL END,updated_at=now()
    WHERE id=p_recipient_id AND claim_id=p_claim_id AND status='sending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Send claim no longer matches'; END IF;
  -- The next gap starts AFTER the outbound request finishes, not before media upload.
  UPDATE floral_campaign_clocks SET next_send_at=greatest(next_send_at,clock_timestamp()+interval '60 seconds') WHERE account_id=recipient.account_id;
  UPDATE floral_campaigns c SET status='completed',updated_at=now() WHERE c.id=recipient.campaign_id AND c.status<>'cancelled'
    AND NOT EXISTS (SELECT 1 FROM floral_campaign_recipients r WHERE r.campaign_id=c.id AND r.status IN ('pending','sending'));
END; $$;

CREATE OR REPLACE FUNCTION public.control_floral_campaign(p_account_id uuid,p_campaign_id uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM floral_campaign_clocks WHERE account_id=p_account_id FOR UPDATE;
  IF p_action NOT IN ('pause','resume','cancel') THEN RAISE EXCEPTION 'Unknown campaign action'; END IF;
  UPDATE floral_campaigns SET status=CASE p_action WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'queued' ELSE 'cancelled' END,updated_at=now()
    WHERE id=p_campaign_id AND account_id=p_account_id AND status IN ('queued','running','paused');
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found or already finished'; END IF;
  IF p_action='cancel' THEN UPDATE floral_campaign_recipients SET status='skipped',error_message='Campaign cancelled',updated_at=now() WHERE campaign_id=p_campaign_id AND account_id=p_account_id AND status='pending'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.floral_campaign_due_accounts()
RETURNS TABLE(account_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT clock.account_id FROM floral_campaign_clocks clock WHERE clock.next_send_at <= now()
    AND EXISTS (SELECT 1 FROM floral_campaign_recipients r JOIN floral_campaigns c ON c.id=r.campaign_id
      WHERE r.account_id=clock.account_id AND ((r.status='pending' AND c.status IN ('queued','running')) OR r.status='sending'))
    ORDER BY clock.next_send_at LIMIT 5;
$$;

CREATE OR REPLACE FUNCTION public.invoke_floral_campaign_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE worker public.floral_campaign_worker;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM floral_campaign_due_accounts()) THEN RETURN; END IF;
  SELECT * INTO worker FROM floral_campaign_worker WHERE id=true;
  PERFORM net.http_post(url:=worker.endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker.secret),body:='{}'::jsonb,timeout_milliseconds:=55000);
END; $$;
CREATE OR REPLACE FUNCTION public.floral_campaign_health()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('ready',EXISTS(SELECT 1 FROM cron.job WHERE jobname='techzolo-floral-campaigns' AND active),
    'last_tick_at',(SELECT last_tick_at FROM floral_campaign_worker WHERE id=true));
$$;

REVOKE ALL ON FUNCTION public.create_floral_campaign(uuid,uuid,uuid,text,jsonb),public.claim_floral_campaign_recipient(uuid),public.finish_floral_campaign_recipient(uuid,uuid,text,text,text),public.control_floral_campaign(uuid,uuid,text),public.floral_campaign_due_accounts(),public.invoke_floral_campaign_tick(),public.floral_campaign_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_floral_campaign(uuid,uuid,uuid,text,jsonb),public.claim_floral_campaign_recipient(uuid),public.finish_floral_campaign_recipient(uuid,uuid,text,text,text),public.control_floral_campaign(uuid,uuid,text),public.floral_campaign_due_accounts(),public.invoke_floral_campaign_tick(),public.floral_campaign_health() TO service_role;
-- Poll due work frequently; the account clock still enforces 60 seconds between sends.
SELECT cron.schedule('techzolo-floral-campaigns','10 seconds','SELECT public.invoke_floral_campaign_tick();');
NOTIFY pgrst, 'reload schema';
