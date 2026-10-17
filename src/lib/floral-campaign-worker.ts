import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage, MetaApiError } from '@/lib/whatsapp/meta-api'
import { resolveTemplateRow } from '@/lib/whatsapp/template-body'
import { FLORAL_TEMPLATE_NAME } from './floral-campaign-input'

interface ClaimedRecipient {
  id: string; account_id: string; campaign_id: string; phone: string; claim_id: string
}

/** One durable claim, one outbound attempt; never blindly retry an uncertain send. */
export async function processFloralAccount(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await db.rpc('claim_floral_campaign_recipient', { p_account_id: accountId })
  if (error) throw new Error('Could not claim the next campaign recipient')
  const recipient = (data as ClaimedRecipient[] | null)?.[0]
  if (!recipient) return false
  let outcome: 'sent' | 'failed' | 'unknown' = 'failed'
  let messageId: string | null = null, reason: string | null = null, pause = false
  let sending = false
  try {
    const { data: campaign, error: campaignError } = await db.from('floral_campaigns')
      .select('template_name,template_language').eq('id', recipient.campaign_id).eq('account_id', accountId).single()
    const { data: config, error: configError } = await db.from('whatsapp_config')
      .select('phone_number_id,access_token').eq('account_id', accountId).single()
    if (campaignError || configError || !campaign || !config || campaign.template_name !== FLORAL_TEMPLATE_NAME) {
      pause = true
      throw new Error('Campaign or WhatsApp configuration is unavailable. Check settings before resuming.')
    }
    const resolved = await resolveTemplateRow(db, accountId, FLORAL_TEMPLATE_NAME, campaign.template_language)
    if (!resolved.row || resolved.malformed || resolved.row.status !== 'APPROVED') {
      pause = true
      throw new Error('The floral template must be approved and synced before this campaign can continue.')
    }
    const token = decrypt(config.access_token)
    sending = true
    const result = await sendTemplateMessage({
      phoneNumberId: config.phone_number_id, accessToken: token, to: recipient.phone.slice(1),
      templateName: FLORAL_TEMPLATE_NAME, language: resolved.language, template: resolved.row,
    })
    outcome = 'sent'; messageId = result.messageId
  } catch (error) {
    reason = error instanceof Error ? error.message : 'Campaign delivery failed'
    // A Meta rejection confirms the request failed. A network failure may have
    // happened after acceptance, so hold it for review rather than duplicate it.
    outcome = sending && (!(error instanceof MetaApiError) || error.httpStatus >= 500) ? 'unknown' : 'failed'
    pause ||= error instanceof MetaApiError && [10, 190, 200].includes(error.code ?? 0)
  }
  const { error: finishError } = await db.rpc('finish_floral_campaign_recipient', {
    p_recipient_id: recipient.id, p_claim_id: recipient.claim_id,
    p_status: outcome, p_message_id: messageId, p_error: reason,
  })
  if (finishError) throw new Error('Delivery result could not be saved. The recipient will not be automatically retried.')
  if (pause) await db.rpc('control_floral_campaign', { p_account_id: accountId, p_campaign_id: recipient.campaign_id, p_action: 'pause' })
  return true
}
