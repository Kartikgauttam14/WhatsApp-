import { describe, expect, it } from 'vitest'
import { parseFloralAudience } from './floral-campaign-input'

describe('floral campaign audience', () => {
  it('accepts pasted international numbers and deduplicates formatting', () => {
    const result = parseFloralAudience('+91 98765 43210\n+919876543210; +971501234567')
    expect(result.recipients).toEqual([{ phone: '+919876543210' }, { phone: '+971501234567' }])
    expect(result.duplicates).toBe(1)
    expect(result.invalid).toEqual([])
  })
  it('accepts BOM, phone aliases, escaped quotes and multiline names in CSV', () => {
    const result = parseFloralAudience('\uFEFFmobile number,name\r\n"+919876543210","Ali, \"\"Customer\"\"\nDelhi"\r\n+971501234567,Sam')
    expect(result.recipients).toEqual([{ phone: '+919876543210', name: 'Ali, "Customer"\nDelhi' }, { phone: '+971501234567', name: 'Sam' }])
  })
  it('does not guess a country code or extract a number from prose', () => {
    const result = parseFloralAudience('9876543210\ncall +919876543210\n+919876543211')
    expect(result.invalid).toHaveLength(2)
    expect(result.recipients).toEqual([{ phone: '+919876543211' }])
  })
  it('accepts explicit 00 international prefixes', () => {
    expect(parseFloralAudience('00919876543210').recipients).toEqual([{ phone: '+919876543210' }])
  })
  it('counts blank CSV phones as invalid instead of silently dropping a row', () => {
    const result = parseFloralAudience('phone,name\n,Missing\n+919876543210,Valid')
    expect(result.invalid).toEqual([{ row: 2, value: '' }])
    expect(result.recipients).toHaveLength(1)
  })
  it('preserves the first name when the CSV repeats a phone', () => {
    const result = parseFloralAudience('phone,name\n+919876543210,First\n+91 98765 43210,Second')
    expect(result.recipients[0].name).toBe('First')
    expect(result.duplicates).toBe(1)
  })
  it('rejects malformed quotes and oversized input', () => {
    expect(() => parseFloralAudience('phone,name\n"+919876543210,Name')).toThrow(/unclosed/)
    expect(() => parseFloralAudience(' '.repeat(200001))).toThrow(/too large/)
  })
  it('caps unique recipients, after removing duplicates', () => {
    expect(() => parseFloralAudience(Array.from({ length: 1001 }, (_, i) => `+919000${String(i).padStart(6, '0')}`).join('\n'))).toThrow(/1,000/)
    expect(parseFloralAudience(Array.from({ length: 1001 }, () => '+919876543210').join('\n')).recipients).toHaveLength(1)
  })
})
