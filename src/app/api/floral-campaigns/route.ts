import { after, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseFloralAudience } from '@/lib/floral-campaign-input'
import { processFloralAccount } from '@/lib/floral-campaign-worker'

export const maxDuration = 60

export async function GET() {
  try {
    const { accountId } = await requireRole('viewer')
    const db = supabaseAdmin()
    const [health, campaigns] = await Promise.all([
      db.rpc('floral_campaign_health'),
      db.from('floral_campaign_summaries').select('*').eq('account_id', accountId).order('created_at', { ascending: false }).limit(30),
    ])
    if (health.error || campaigns.error) return NextResponse.json({ error: 'Background campaigns need database setup.', setup_required: true }, { status: 503 })
    return NextResponse.json({ health: health.data, campaigns: campaigns.data })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    if (Number(request.headers.get('content-length')) > 250_000) return NextResponse.json({ error: 'Recipient input is too large.' }, { status: 413 })
    const body = await request.json().catch(() => null)
    if (!body || typeof body.input !== 'string' || typeof body.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id)) {
      return NextResponse.json({ error: 'Provide a recipient list and a valid campaign request ID.' }, { status: 400 })
    }
    let audience
    try { audience = parseFloralAudience(body.input) }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid input' }, { status: 400 }) }
    if (!audience.recipients.length || audience.invalid.length) {
      return NextResponse.json({ error: 'Correct the invalid numbers before starting. Include + and country code.', invalid: audience.invalid }, { status: 400 })
    }
    const db = supabaseAdmin()
    const health = await db.rpc('floral_campaign_health')
    if (health.error || !health.data?.ready) return NextResponse.json({ error: 'Background sending is not configured yet.' }, { status: 503 })
    const { data: id, error } = await db.rpc('create_floral_campaign', {
      p_account_id: accountId, p_user_id: userId, p_request_id: body.request_id,
      p_name: typeof body.name === 'string' ? body.name.slice(0, 120) : 'Floral fragrances campaign',
      p_recipients: audience.recipients,
    })
    if (error) return NextResponse.json({ error: 'Could not create the campaign. Check the approved floral template and try again.' }, { status: 400 })
    after(async () => { try { await processFloralAccount(db, accountId) } catch { console.error('[floral-campaign] Initial worker attempt failed; queue remains stored.') } })
    return NextResponse.json({ id, recipients: audience.recipients.length, duplicates_removed: audience.duplicates }, { status: 202 })
  } catch (error) { return toErrorResponse(error) }
}
