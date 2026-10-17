import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils'

export const FLORAL_TEMPLATE_NAME = 'mansam_floral_collection'
export const FLORAL_INTERVAL_SECONDS = 60
export const FLORAL_MAX_RECIPIENTS = 1000

export interface FloralRecipient { phone: string; name?: string }
export interface FloralAudience {
  recipients: FloralRecipient[]
  duplicates: number
  invalid: Array<{ row: number; value: string }>
}

/** CSV with escaped quotes/newlines, or a comma/newline-separated number list. */
function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.trim()); cell = ''
      if (c === '\n') { if (row.some(Boolean)) rows.push(row); row = [] }
    } else if (c !== '\r' || quoted) cell += c
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.')
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export function parseFloralAudience(input: string): FloralAudience {
  if (input.length > 200_000) throw new Error('The recipient file is too large. Use up to 1,000 unique numbers.')
  const text = input.replace(/^\uFEFF/, '').trim()
  if (!text) return { recipients: [], duplicates: 0, invalid: [] }
  const rows = csvRows(text)
  const header = rows[0].map(s => s.toLowerCase().replace(/[\s-]+/g, '_'))
  const phoneIndex = header.findIndex(s => ['phone', 'phone_number', 'mobile', 'mobile_number', 'number', 'whatsapp', 'whatsapp_number'].includes(s))
  const nameIndex = header.findIndex(s => ['name', 'customer_name', 'full_name'].includes(s))
  const entries = phoneIndex >= 0
    ? rows.slice(1).map((r, i) => ({ value: r[phoneIndex] ?? '', name: nameIndex >= 0 ? r[nameIndex] : undefined, row: i + 2 }))
    : text.split(/[,;\n\t]+/).filter(s => s.trim()).map((s, i) => ({ value: s.trim().replace(/^"|"$/g, ''), name: undefined, row: i + 1 }))
  const result: FloralAudience = { recipients: [], duplicates: 0, invalid: [] }
  const seen = new Set<string>()
  for (const entry of entries) {
    const value = entry.value.trim().replace(/^'/, '').replace(/^00/, '+')
    const digits = /^[+\d\s().-]+$/.test(value) ? parseInternationalPhone(value) : null
    if (!digits) { result.invalid.push({ row: entry.row, value: entry.value.slice(0, 80) }); continue }
    const phone = '+' + digits
    if (seen.has(phone)) { result.duplicates++; continue }
    seen.add(phone)
    result.recipients.push({ phone, ...(entry.name?.trim() ? { name: entry.name.trim().slice(0, 120) } : {}) })
  }
  if (result.recipients.length > FLORAL_MAX_RECIPIENTS) throw new Error('Use at most 1,000 unique numbers per campaign.')
  return result
}
