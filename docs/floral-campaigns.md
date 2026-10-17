# Floral campaigns

Open **Broadcasts → Floral campaign · 1/min** or `/broadcasts/floral`.

1. Upload a CSV with a `phone` column and optional `name`, or paste numbers separated by commas or newlines.
2. Include `+` and country code on each number. A blank CSV format is available on the page.
3. Review the normalized audience. Duplicate numbers are removed. Invalid entries must be corrected before starting.
4. Click **Start campaign**. The approved `mansam_floral_collection` template is sent as one three-card message per recipient.

The queue lives in Supabase and continues with the browser closed. All floral campaigns in an account share a clock: a minimum 60-second gap is measured after each outbound attempt finishes. Network time and scheduler polling can make the gap longer. Campaigns are processed oldest first.

The page shows queued, sending, sent, delivered, read, failed, unconfirmed and skipped counts. Pause/resume affects remaining recipients. Cancelling skips remaining recipients; a send already in progress can finish.

A recipient is claimed once per campaign. Network interruptions and stale in-flight claims are held as unconfirmed, not retried. This provides at-most-once attempts rather than promising exactly-once delivery over an unreliable network. Review those cases before intentionally creating another campaign for the same numbers.

Duplicate browser submissions reuse a campaign request ID. Database uniqueness also prevents the same normalized number from appearing twice within a campaign. Starting a new campaign is a separate, intentional send; deduplication does not suppress recipients across all future campaigns.

## Deployment

Apply `supabase/migrations/047_floral_campaign_queue.sql` in the Supabase SQL editor before deploying the feature. It enables `pg_cron` and `pg_net`, creates the queue and service-only claim functions, and generates a private worker credential inside the database. No extra Vercel environment variable is required.

The scheduler polls every 10 seconds but makes HTTP calls only when work is due. Atomic account clocks enforce the sending interval. No CSV or recipients are seeded by the migration.

The initial worker endpoint is `https://whats-app-eight-sigma.vercel.app/api/floral-campaigns/tick`. If hosting on a different domain, an administrator must update `floral_campaign_worker.endpoint` to that application's HTTPS tick URL. The worker credential must not be exposed in client code, public configuration, logs or screenshots.

Read permissions follow account membership. Creating, pausing, resuming or cancelling requires an agent or higher role. Claims and background credentials are service-only. The endpoint rejects requests without its private bearer credential.

The unpaced broadcast creation/resume APIs reject the floral template, and selecting it in the ordinary wizard redirects to the paced flow. Manual one-to-one inbox template sends remain available.
