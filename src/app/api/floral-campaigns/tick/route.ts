import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { processFloralAccount } from '@/lib/floral-campaign-worker'

export const maxDuration = 60

export async function POST(request: Request) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!/^[a-f0-9]{64}$/.test(supplied)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const { data: worker, error } = await db.from('floral_campaign_worker').select('secret').eq('id', true).single()
  if (error || !worker || worker.secret.length !== supplied.length || !timingSafeEqual(Buffer.from(worker.secret), Buffer.from(supplied))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  await db.from('floral_campaign_worker').update({ last_tick_at: new Date().toISOString() }).eq('id', true)
  const due = await db.rpc('floral_campaign_due_accounts')
  if (due.error) return NextResponse.json({ error: 'Could not read the campaign queue.' }, { status: 500 })
  const results = await Promise.allSettled((due.data as Array<{ account_id: string }>).map(row => processFloralAccount(db, row.account_id)))
  const failures = results.filter(r => r.status === 'rejected').length
  return NextResponse.json({ processed: results.filter(r => r.status === 'fulfilled' && r.value).length, failures }, { status: failures ? 503 : 200 })
}
