import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireRole('viewer')
    const { id } = await context.params
    const { data, error } = await supabaseAdmin().from('floral_campaign_recipients')
      .select('id,phone,name,status,sent_at,error_message').eq('account_id', accountId).eq('campaign_id', id).order('position').limit(1000)
    if (error) return NextResponse.json({ error: 'Could not load recipients.' }, { status: 500 })
    return NextResponse.json({ recipients: data })
  } catch (error) { return toErrorResponse(error) }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { accountId } = await requireRole('agent')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!['pause', 'resume', 'cancel'].includes(body?.action)) return NextResponse.json({ error: 'Invalid campaign action.' }, { status: 400 })
    const { error } = await supabaseAdmin().rpc('control_floral_campaign', { p_account_id: accountId, p_campaign_id: id, p_action: body.action })
    if (error) return NextResponse.json({ error: 'Campaign is unavailable or already finished.' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}
