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
 * Sample URLs are downloaded and uploaded to the phone's media endpoint before
 * sending: Meta's delivery workers can reject otherwise-readable CDN links.
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

/** Convert approval-preview links into actual send-time WhatsApp media IDs. */
export async function uploadCarouselCardMedia(
  carousel: CarouselSendComponent,
  phoneNumberId: string,
  accessToken: string,
  apiBase: string,
): Promise<CarouselSendComponent> {
  const cards = await Promise.all(carousel.cards.map(async card => ({
    ...card,
    components: await Promise.all(card.components.map(async component => {
      if (component.type !== 'header') return component
      const parameters = await Promise.all(component.parameters.map(async parameter => {
        if (parameter.type !== 'image' && parameter.type !== 'video') return parameter
        const source = parameter.type === 'image' ? parameter.image : parameter.video
        if (source.id) return parameter
        const url = new URL(source.link ?? '')
        // These links come from Meta's approved definition. Restrict downloads
        // to Meta's CDN and refuse redirects; never forward the bearer token.
        if (url.protocol !== 'https:' || url.username || url.password ||
          !(url.hostname === 'scontent.whatsapp.net' || url.hostname.endsWith('.fbcdn.net'))) {
          throw new Error(`Carousel card ${card.card_index + 1} has an unsupported media host.`)
        }
        const download = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
        if (!download.ok || !download.body) {
          throw new Error(`Could not download carousel card ${card.card_index + 1} image (HTTP ${download.status}).`)
        }
        const mime = download.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
        const isImage = parameter.type === 'image'
        if (!(isImage ? ['image/jpeg', 'image/png'] : ['video/mp4', 'video/3gpp']).includes(mime)) {
          await download.body.cancel()
          throw new Error(`Carousel card ${card.card_index + 1} has an unsupported media type.`)
        }
        const limit = (isImage ? 5 : 16) * 1024 * 1024
        if (Number(download.headers.get('content-length')) > limit) {
          await download.body.cancel()
          throw new Error(`Carousel card ${card.card_index + 1} exceeds the media size limit.`)
        }
        const reader = download.body.getReader()
        const chunks: ArrayBuffer[] = []
        let bytes = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > limit) {
            await reader.cancel()
            throw new Error(`Carousel card ${card.card_index + 1} exceeds the media size limit.`)
          }
          chunks.push(Uint8Array.from(value).buffer)
        }
        if (!bytes) throw new Error(`Carousel card ${card.card_index + 1} has empty media.`)
        const form = new FormData()
        form.set('messaging_product', 'whatsapp')
        form.set('type', mime)
        form.set('file', new Blob(chunks, { type: mime }), `card-${card.card_index}.${mime === 'image/png' ? 'png' : isImage ? 'jpg' : 'mp4'}`)
        const upload = await fetch(`${apiBase}/${encodeURIComponent(phoneNumberId)}/media`, {
          method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
          body: form, signal: AbortSignal.timeout(20_000),
        })
        const result: { id?: string; error?: { message?: string } } = await upload.json()
        if (!upload.ok || !result.id) {
          throw new Error(`Carousel card ${card.card_index + 1} media upload failed: ${result.error?.message ?? `HTTP ${upload.status}`}`)
        }
        return isImage
          ? { type: 'image' as const, image: { id: result.id } }
          : { type: 'video' as const, video: { id: result.id } }
      }))
      return { ...component, parameters }
    })),
  })))
  return { type: 'carousel', cards }
}
