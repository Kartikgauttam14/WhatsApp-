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
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: [`https://cdn.example/${name}.jpg`] } },
    { type: 'BODY', text: name },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Shop Now', url: `https://shop.example/${name}` }] },
  ] })),
})
afterEach(() => vi.unstubAllGlobals())

describe('approved carousel send components', () => {
  it('includes every card in approval order with its own media link', () => {
    expect(buildCarouselSendComponent(template, carousel())).toEqual({ type: 'carousel', cards: [
      { card_index: 0, components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example/rose.jpg' } }] }] },
      { card_index: 1, components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example/jasmine.jpg' } }] }] },
      { card_index: 2, components: [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example/floral.jpg' } }] }] },
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: template.name, language: 'en', status: 'APPROVED', components: [carousel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'wamid.carousel' }] })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendTemplateMessage(args)).toEqual({ messageId: 'wamid.carousel' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/meta-id?fields=')
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(sent.template).toMatchObject({ name: template.name, language: { code: 'en' } })
    expect(sent.template.components).toEqual([buildCarouselSendComponent(template, carousel())])
    expect(sent.to).toBe(args.to)
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
    await sendTemplateMessage({ ...args, template: { ...template, header_type: 'image', header_media_url: 'https://cdn.example/image.jpg' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.template.components[0].type).toBe('header')
  })
})
