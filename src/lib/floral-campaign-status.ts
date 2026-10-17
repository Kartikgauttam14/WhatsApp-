import type { SupabaseClient } from '@supabase/supabase-js'

export async function mirrorFloralDeliveryStatus(db: SupabaseClient, phoneNumberId: string | undefined, messageId: string, status: string, errorMessage?: string) {
  const previous = status === 'read' ? ['sent', 'delivered'] : status === 'delivered' || status === 'failed' ? ['sent'] : []
  if (!phoneNumberId || !previous.length) return
  const { data: configs, error: configError } = await db.from('whatsapp_config').select('account_id').eq('phone_number_id', phoneNumberId)
  if (configError || configs?.length !== 1) return
  const { error } = await db.from('floral_campaign_recipients')
    .update({ status, updated_at: new Date().toISOString(), ...(errorMessage ? { error_message: errorMessage } : {}) })
    .eq('account_id', configs[0].account_id).eq('whatsapp_message_id', messageId).in('status', previous)
  if (error && error.code !== 'PGRST205' && error.code !== '42P01') console.error('[floral-campaign] Delivery update failed:', error.code)
}
