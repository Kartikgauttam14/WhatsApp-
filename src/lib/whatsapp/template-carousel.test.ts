import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageTemplate } from '@/types'
import { buildCarouselSendComponent, type MetaTemplateComponent } from './template-carousel'
import { sendTemplateMessage } from './meta-api'

const template: MessageTemplate = {
  id: 'local-id', user_id: 'owner', name: 'floral_collection', language: 'en',
  category: 'Marketing', status: 'APPROVED', meta_template_id: 'meta-id',
  body_text: 'Swipe to find your favourite.', created_at: '2026-10-17T00:00:00Z',
}
const carousel = (): MetaTemplateComponent => ({
  type: 'CAROUSEL', cards: ['rose', 'jasmine', 'floral'].map(name => ({ components: [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: [`https://scontent.whatsapp.net/${name}.jpg`] } },
    { type: 'BODY', text: name },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Shop Now', url: `https://shop.example/${name}` }] },
  ] })),
})
afterEach(() => vi.unstubAllGlobals())

describe('approved carousel send components', () => {
  it('includes every card in approval order with its own media link', () => {
    expect(buildCarouselSendComponent(template, carousel())).toEqual({ type: 'carousel', cards: [
      { card_index: 0, components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://scontent.whatsapp.net/rose.jpg' } }] }] },
      { card_index: 1, components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://scontent.whatsapp.net/jasmine.jpg' } }] }] },
      { card_index: 2, components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://scontent.whatsapp.net/floral.jpg' } }] }] },
    ] })
    // Static body and URL button content are supplied by Meta's approved
    // template, not resent as mismatched send-time parameters.
  })
  it('does not mistake a resumable upload handle for sendable media', () => {
    const c = carousel()
    c.cards![1].components[0].example = { header_handle: ['4::upload-handle'] }
    expect(() => buildCarouselSendComponent(template, c)).toThrow(/card 2 has no reusable approved media URL/)
  })
  it('fails with the card number when a body variable lacks a value', () => {
    const c = carousel()
    c.cards![1].components[1].text = 'Hello {{1}}'
    expect(() => buildCarouselSendComponent(template, c)).toThrow(/Carousel card 2:/)
  })
  it('does not silently discard dynamic URL button values', () => {
    const c = carousel()
    c.cards![0].components[2].buttons![0].url = 'https://shop.example/{{1}}'
    expect(() => buildCarouselSendComponent(template, c)).toThrow(/Carousel card 1:/)
  })
  it('rejects incomplete carousels', () => {
    expect(() => buildCarouselSendComponent(template, { type: 'CAROUSEL', cards: [] })).toThrow(/2–10 cards/)
  })
})

describe('carousel through the real Meta sender', () => {
  const args = { phoneNumberId: 'phone', accessToken: 'test-token', to: '15551230000',
    templateName: template.name, language: 'en', template }
  it('loads the approved definition and posts all three cards in one template', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/meta-id?')) return new Response(JSON.stringify({ name: template.name, language: 'en', status: 'APPROVED', components: [carousel()] }))
      if (new URL(url).hostname === 'scontent.whatsapp.net') {
        expect(init?.headers).toBeUndefined()
        expect(init?.redirect).toBe('error')
        return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } })
      }
      if (String(url).endsWith('/media')) {
        const form = init!.body as FormData
        expect(form.get('messaging_product')).toBe('whatsapp')
        expect(form.get('type')).toBe('image/jpeg')
        const file = form.get('file') as File
        expect(file.size).toBe(4)
        return new Response(JSON.stringify({ id: `uploaded-${file.name}` }))
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.carousel' }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendTemplateMessage(args)).toEqual({ messageId: 'wamid.carousel' })
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(fetchMock.mock.calls[0][0]).toContain('/meta-id?fields=')
    const messageCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/messages'))!
    const sent = JSON.parse(messageCall[1]!.body as string)
    expect(sent.template).toMatchObject({ name: template.name, language: { code: 'en' } })
    expect(sent.template.components).toEqual([{ type: 'carousel', cards: [0, 1, 2].map(card_index => ({
      card_index, components: [{ type: 'header', parameters: [{ type: 'image', image: { id: `uploaded-card-${card_index}.jpg` } }] }],
    })) }])
    expect(sent.to).toBe(args.to)
  })
  it.each(['forbidden', 'oversized', 'upload-failed'])('does not send a message when media preparation is %s', async failure => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/meta-id?')) return new Response(JSON.stringify({ name: template.name, language: 'en', status: 'APPROVED', components: [carousel()] }))
      if (new URL(url).hostname === 'scontent.whatsapp.net') {
        if (failure === 'forbidden') return new Response('Forbidden', { status: 403 })
        return new Response(new Uint8Array([255, 216, 255, 217]), { headers: {
          'content-type': 'image/jpeg', ...(failure === 'oversized' ? { 'content-length': '5242881' } : {}),
        } })
      }
      return new Response(JSON.stringify({ error: { message: 'Upload rejected' } }), { status: 400 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendTemplateMessage(args)).rejects.toThrow(/card/i)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(false)
  })
  it('rejects a private media destination before making a download request', async () => {
    const c = carousel()
    for (const card of c.cards!) card.components[0].example = { header_handle: ['https://127.0.0.1/image.jpg'] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: template.name, language: 'en', status: 'APPROVED', components: [c] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendTemplateMessage(args)).rejects.toThrow(/unsupported media host/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not send using a different or unapproved template definition', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ name: 'other_template', language: 'en', status: 'APPROVED', components: [carousel()] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendTemplateMessage(args)).rejects.toThrow(/does not match/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('keeps ordinary image template sends on the existing path', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'wamid.image' }] })))
    vi.stubGlobal('fetch', fetchMock)
    await sendTemplateMessage({ ...args, template: { ...template, header_type: 'image', header_media_url: 'https://scontent.whatsapp.net/image.jpg' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.template.components[0].type).toBe('header')
  })
})
