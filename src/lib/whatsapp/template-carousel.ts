import type { MessageTemplate, TemplateButton } from '@/types'
import { buildSendComponents, type MetaSendComponent } from './template-send-builder'

/** The creation-time definition returned by GET /{template_id}. */
export interface MetaTemplateComponent {
  type: string
  format?: string
  text?: string
  example?: { header_handle?: string[] }
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string; example?: string[] | string }>
  cards?: Array<{ components: MetaTemplateComponent[] }>
}

export interface CarouselSendComponent {
  type: 'carousel'
  cards: Array<{ card_index: number; components: MetaSendComponent[] }>
}

/**
 * Synced rows contain the top-level body but not carousel cards. Read the
 * approved definition at send time, keeping card order and static buttons in
 * Meta's template. Each card still needs its media header on every delivery.
 * Only an actual HTTPS sample URL is reusable; upload handles are not media IDs.
 */
export function buildCarouselSendComponent(
  template: MessageTemplate,
  carousel: MetaTemplateComponent,
): CarouselSendComponent {
  if (!Array.isArray(carousel.cards) || carousel.cards.length < 2 || carousel.cards.length > 10) {
    throw new Error('The approved carousel must contain 2–10 cards.')
  }
  const cards = carousel.cards.map((card, card_index) => {
    if (!Array.isArray(card.components)) throw new Error(`Carousel card ${card_index + 1} has no components.`)
    const header = card.components.find(c => c.type === 'HEADER')
    const body = card.components.find(c => c.type === 'BODY')
    const buttons = card.components.find(c => c.type === 'BUTTONS')?.buttons ?? []
    const format = header?.format?.toLowerCase()
    if (format !== 'image' && format !== 'video') {
      throw new Error(`Carousel card ${card_index + 1} requires an image or video header.`)
    }
    const sample = header?.example?.header_handle?.[0]
    let media: URL
    try {
      media = new URL(sample ?? '')
      if (media.protocol !== 'https:' || media.username || media.password) throw new Error('Invalid media URL')
    } catch {
      throw new Error(`Carousel card ${card_index + 1} has no reusable approved media URL. Add its media in Meta, then retry.`)
    }
    const parsedButtons: TemplateButton[] = buttons.map(button => {
      if (button.type === 'URL' && typeof button.url === 'string') {
        return { type: 'URL', text: button.text, url: button.url }
      }
      if (button.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text: button.text }
      if (button.type === 'PHONE_NUMBER' && typeof button.phone_number === 'string') {
        return { type: 'PHONE_NUMBER', text: button.text, phone_number: button.phone_number }
      }
      throw new Error(`Carousel card ${card_index + 1} has an unsupported ${button.type} button.`)
    })
    // Card variables need explicit per-card values. Never turn approval examples
    // into customer data or silently omit a variable-bearing body/button.
    try {
      const components = buildSendComponents({
        ...template,
        header_type: format,
        header_content: undefined,
        header_handle: undefined,
        header_media_url: media.href,
        body_text: body?.text ?? '',
        buttons: parsedButtons,
      })
      return { card_index, components }
    } catch (error) {
      throw new Error(`Carousel card ${card_index + 1}: ${error instanceof Error ? error.message : 'invalid send parameters'}`)
    }
  })
  return { type: 'carousel', cards }
}
