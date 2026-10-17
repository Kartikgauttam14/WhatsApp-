'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCan } from '@/hooks/use-can'
import { parseFloralAudience } from '@/lib/floral-campaign-input'

interface Campaign {
  id: string; name: string; status: string; total_recipients: number; pending_count: number
  sending_count: number; sent_count: number; delivered_count: number; read_count: number
  failed_count: number; unknown_count: number; skipped_count: number
}
interface Recipient { id: string; phone: string; name?: string; status: string; error_message?: string }

export default function FloralCampaignPage() {
  const canSend = useCan('send-messages')
  const [input, setInput] = useState(''), [name, setName] = useState('Floral fragrances campaign')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [ready, setReady] = useState(false), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [submitted, setSubmitted] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const requestId = useRef<string | null>(null)
  const preview = useMemo(() => {
    try { return { audience: parseFloralAudience(input), error: '' } }
    catch (error) { return { audience: null, error: error instanceof Error ? error.message : 'Invalid list' } }
  }, [input])
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/floral-campaigns', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load campaigns')
      setReady(Boolean(data.health?.ready)); setCampaigns(data.campaigns); setError('')
      if (selectedId) {
        const details = await fetch(`/api/floral-campaigns/${selectedId}`, { cache: 'no-store' })
        const payload = await details.json()
        if (details.ok) setRecipients(payload.recipients)
      }
    } catch (error) { setReady(false); setError(error instanceof Error ? error.message : 'Could not load campaigns') }
  }, [selectedId])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  function changeInput(text: string) { setInput(text); setSubmitted(false); requestId.current = null }
  async function upload(file?: File) {
    if (!file) return
    if (file.size > 200_000) { toast.error('Use a CSV smaller than 200 KB.'); return }
    try { changeInput(await file.text()) } catch { toast.error('Could not read this CSV file.') }
  }
  async function start() {
    if (busy || submitted) return
    setBusy(true)
    requestId.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/floral-campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, name, request_id: requestId.current }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not start campaign')
      setSubmitted(true); setSelectedId(data.id)
      toast.success('Campaign queued. Background sending will continue when this tab is closed.')
      await refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not start campaign') }
    finally { setBusy(false) }
  }
  async function control(id: string, action: string) {
    setBusy(true)
    try {
      const response = await fetch(`/api/floral-campaigns/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Campaign action failed')
      await refresh()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Campaign action failed') }
    finally { setBusy(false) }
  }
  const audience = preview.audience
  return <div className="mx-auto max-w-5xl space-y-6">
    <Link href="/broadcasts" className="text-sm text-muted-foreground hover:text-foreground">← Broadcasts</Link>
    <header>
      <h1 className="text-2xl font-bold">Floral fragrance campaigns</h1>
      <p className="mt-2 text-sm text-muted-foreground">Upload a CSV or paste numbers. Each unique number receives the approved three-card floral template once per campaign.</p>
      <p className="mt-1 text-sm text-muted-foreground">Maximum one send every 60 seconds across your floral campaigns. Background sending continues with the browser closed.</p>
    </header>
    {error && <p role="alert" className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-500">{error}</p>}
    <section className="space-y-4 rounded-xl border border-border p-5">
      <div className="space-y-2"><Label htmlFor="campaign-name">Campaign name</Label><Input id="campaign-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} disabled={busy || submitted} /></div>
      <div className="space-y-2"><Label htmlFor="recipient-csv">Upload CSV</Label><Input id="recipient-csv" type="file" accept=".csv,text/csv" onChange={e => void upload(e.target.files?.[0])} disabled={busy || submitted} />
        <p className="text-xs text-muted-foreground">CSV columns: phone, name (optional). Up to 1,000 unique numbers, with + and country code.</p>
        <a href="/floral-campaign-example.csv" download className="text-xs text-primary underline">Download blank CSV format</a>
      </div>
      <div className="space-y-2"><Label htmlFor="recipient-list">CSV content or phone numbers</Label>
        <Textarea id="recipient-list" className="min-h-36 font-mono text-sm" value={input} disabled={busy || submitted} onChange={e => changeInput(e.target.value)} placeholder={'phone,name\n+919876543210,Customer\n\nOr paste numbers, one per line.'} />
      </div>
      {preview.error && <p role="alert" className="text-sm text-red-400">{preview.error}</p>}
      {audience && input.trim() && <div className="space-y-2 text-sm">
        <p>{audience.recipients.length} unique recipients · {audience.duplicates} duplicates removed · {audience.invalid.length} invalid entries</p>
        {audience.invalid.length > 0 && <p role="alert" className="text-red-400">Correct these entries before starting: {audience.invalid.slice(0, 5).map(r => `row ${r.row}: ${r.value || '(empty)'}`).join('; ')}</p>}
        <div className="max-h-36 overflow-auto rounded border border-border p-2 font-mono text-xs">{audience.recipients.slice(0, 20).map(r => <div key={r.phone}>{r.phone}{r.name ? ` · ${r.name}` : ''}</div>)}{audience.recipients.length > 20 && <p>…and {audience.recipients.length - 20} more</p>}</div>
      </div>}
      <p className="text-xs text-muted-foreground">Template: mansam_floral_collection · one message with three cards. Failed or unconfirmed sends are kept for review and are not automatically sent again.</p>
      <div className="flex gap-3">
        <Button onClick={() => void start()} disabled={!canSend || !ready || busy || submitted || !audience?.recipients.length || !!audience.invalid.length || !!preview.error}>{busy ? 'Working…' : submitted ? 'Campaign queued' : `Start campaign${audience?.recipients.length ? ` · ${audience.recipients.length} recipients` : ''}`}</Button>
        {submitted && <Button variant="outline" onClick={() => { changeInput(''); setName('Floral fragrances campaign') }}>New campaign</Button>}
      </div>
    </section>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Campaign progress</h2>
      {!campaigns.length && <p className="text-sm text-muted-foreground">No floral campaigns yet.</p>}
      {campaigns.map(c => <article key={c.id} className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{c.name}</h3><p className="text-xs capitalize text-muted-foreground">{c.status} · {c.total_recipients} recipients</p></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setSelectedId(c.id); setRecipients([]) }}>Details</Button>
            {canSend && ['queued', 'running', 'paused'].includes(c.status) && <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void control(c.id, c.status === 'paused' ? 'resume' : 'pause')}>{c.status === 'paused' ? 'Resume' : 'Pause'}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void control(c.id, 'cancel')}>Cancel remaining</Button>
            </>}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{c.pending_count} queued · {c.sending_count} sending · {c.sent_count} sent · {c.delivered_count} delivered · {c.read_count} read · {c.failed_count} failed · {c.unknown_count} unconfirmed · {c.skipped_count} skipped</p>
        {c.unknown_count > 0 && <p className="text-xs text-amber-500">Unconfirmed recipients are held for review to prevent duplicate messages.</p>}
        {['queued', 'running', 'paused'].includes(c.status) && <p className="text-xs text-muted-foreground">Pause or cancel affects remaining recipients. A send already in progress may finish.</p>}
        {selectedId === c.id && <div className="max-h-64 overflow-auto rounded border border-border p-2 text-xs">{recipients.map(r => <div key={r.id} className="border-b border-border py-2 last:border-0"><span className="font-mono">{r.phone}</span> · {r.status}{r.error_message && <p className="mt-1 text-muted-foreground">{r.error_message}</p>}</div>)}</div>}
      </article>)}
    </section>
  </div>
}
