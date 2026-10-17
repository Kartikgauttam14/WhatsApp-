import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mirrorFloralDeliveryStatus } from './floral-campaign-status'

it('scopes delivery updates by the WhatsApp number owner and guards against status regressions', async () => {
  const filters: unknown[] = []
  const from = vi.fn((table: string) => {
    if (table === 'whatsapp_config') return { select: () => ({ eq: async (key: string, value: string) => {
      filters.push([key, value]); return { data: [{ account_id: 'account-1' }], error: null }
    } }) }
    const chain = {
      eq: (key: string, value: unknown) => { filters.push([key, value]); return chain },
      in: async (key: string, values: string[]) => { filters.push([key, values]); return { error: null } },
    }
    return { update: () => chain }
  })
  await mirrorFloralDeliveryStatus({ from } as unknown as SupabaseClient, 'phone-1', 'wamid-1', 'read')
  expect(filters).toContainEqual(['phone_number_id', 'phone-1'])
  expect(filters).toContainEqual(['account_id', 'account-1'])
  expect(filters).toContainEqual(['whatsapp_message_id', 'wamid-1'])
  expect(filters).toContainEqual(['status', ['sent', 'delivered']])
})
it('does not update when a webhook lacks its originating phone number', async () => {
  const from = vi.fn()
  await mirrorFloralDeliveryStatus({ from } as unknown as SupabaseClient, undefined, 'wamid-1', 'read')
  expect(from).not.toHaveBeenCalled()
})
it('ignores late sent events instead of downgrading delivered/read recipients', async () => {
  const from = vi.fn()
  await mirrorFloralDeliveryStatus({ from } as unknown as SupabaseClient, 'phone-1', 'wamid-1', 'sent')
  expect(from).not.toHaveBeenCalled()
})
