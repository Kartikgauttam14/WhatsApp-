import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { processFloralAccount } from './floral-campaign-worker'
import { sendTemplateMessage, MetaApiError } from '@/lib/whatsapp/meta-api'
import { resolveTemplateRow } from '@/lib/whatsapp/template-body'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }))
vi.mock('@/lib/whatsapp/meta-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/whatsapp/meta-api')>(), sendTemplateMessage: vi.fn(),
}))
vi.mock('@/lib/whatsapp/template-body', () => ({ resolveTemplateRow: vi.fn() }))

const recipient = { id: 'recipient', account_id: 'account', campaign_id: 'campaign', phone: '+919876543210', claim_id: 'claim' }
function database(claims: unknown[] = [recipient], finishError: boolean = false) {
  const filters: unknown[] = []
  const rpc = vi.fn(async (name: string) => ({ data: name === 'claim_floral_campaign_recipient' ? claims : null,
    error: name === 'finish_floral_campaign_recipient' && finishError ? { message: 'write failed' } : null }))
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return chain },
      single: async () => ({ data: table === 'floral_campaigns'
        ? { template_name: 'mansam_floral_collection', template_language: 'en' }
        : { phone_number_id: 'phone', access_token: 'encrypted' }, error: null }),
    }
    return chain
  })
  return { db: { rpc, from } as unknown as SupabaseClient, rpc, filters }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendTemplateMessage).mockResolvedValue({ messageId: 'wamid.test' })
  vi.mocked(resolveTemplateRow).mockResolvedValue({ row: { id: 'template', user_id: 'owner', name: 'mansam_floral_collection',
    category: 'Marketing', body_text: 'Floral collection', status: 'APPROVED', created_at: '', language: 'en' }, malformed: false, language: 'en' })
})
describe('durable floral worker', () => {
  it('makes exactly one send and persists the Meta message ID with its claim token', async () => {
    const { db, rpc, filters } = database()
    expect(await processFloralAccount(db, 'account')).toBe(true)
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(sendTemplateMessage).toHaveBeenCalledWith(expect.objectContaining({ to: '919876543210', templateName: 'mansam_floral_collection' }))
    expect(rpc).toHaveBeenCalledWith('finish_floral_campaign_recipient', expect.objectContaining({ p_recipient_id: 'recipient', p_claim_id: 'claim', p_status: 'sent', p_message_id: 'wamid.test' }))
    expect(filters).toContainEqual(['floral_campaigns', 'account_id', 'account'])
    expect(filters).toContainEqual(['whatsapp_config', 'account_id', 'account'])
  })
  it('does nothing when the database clock or another worker denies the claim', async () => {
    const { db } = database([])
    expect(await processFloralAccount(db, 'account')).toBe(false)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })
  it('holds ambiguous network failures without retrying or using phone variants', async () => {
    vi.mocked(sendTemplateMessage).mockRejectedValue(new Error('Connection reset'))
    const { db, rpc } = database()
    await processFloralAccount(db, 'account')
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('finish_floral_campaign_recipient', expect.objectContaining({ p_status: 'unknown' }))
  })
  it('records a definitive Meta rejection and pauses for permission problems', async () => {
    vi.mocked(sendTemplateMessage).mockRejectedValue(new MetaApiError('Permission denied', { httpStatus: 403, code: 10 }))
    const { db, rpc } = database()
    await processFloralAccount(db, 'account')
    expect(rpc).toHaveBeenCalledWith('finish_floral_campaign_recipient', expect.objectContaining({ p_status: 'failed' }))
    expect(rpc).toHaveBeenCalledWith('control_floral_campaign', expect.objectContaining({ p_action: 'pause', p_account_id: 'account' }))
  })
  it('holds server errors as uncertain instead of retrying them', async () => {
    vi.mocked(sendTemplateMessage).mockRejectedValue(new MetaApiError('Server error', { httpStatus: 500, code: 2 }))
    const { db, rpc } = database()
    await processFloralAccount(db, 'account')
    expect(rpc).toHaveBeenCalledWith('finish_floral_campaign_recipient', expect.objectContaining({ p_status: 'unknown' }))
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
  })
  it('never sends an unapproved template', async () => {
    vi.mocked(resolveTemplateRow).mockResolvedValue({ row: null, malformed: false, language: 'en' })
    const { db, rpc } = database()
    await processFloralAccount(db, 'account')
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('finish_floral_campaign_recipient', expect.objectContaining({ p_status: 'failed' }))
  })
  it('reports a result-write failure without making a second outbound attempt', async () => {
    const { db } = database([recipient], true)
    await expect(processFloralAccount(db, 'account')).rejects.toThrow(/not be automatically retried/)
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
  })
})
