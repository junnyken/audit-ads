/**
 * Đối chiếu URL Ads Manager THẬT với allowlist của extension.
 *
 * Dùng: dán URL thật (mỗi dòng một cái) vào stdin, hoặc truyền làm tham số.
 *
 *   npm run check-urls -- "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123"
 *   pbpaste | npm run check-urls
 *
 * Công cụ này import THẲNG src/shared/validation.ts — chính đoạn mã chạy trong
 * content script — nên kết quả ở đây là điều extension thật sự sẽ làm, không phải
 * bản mô phỏng có thể trôi lệch.
 *
 * Nó không gọi mạng và không cần backend chạy.
 */
import { readFileSync } from 'node:fs'
import { extractAccountId, sanitisePath } from '../src/shared/validation'

interface Row {
  url: string
  host: string
  hostAllowed: boolean
  accountId: string | null
  safePath: string | null
  pageType: string
}

/** Đúng ba host trong content_scripts.matches của manifest. */
function hostAllowed(url: URL): boolean {
  if (url.protocol !== 'https:') return false
  if (url.hostname === 'adsmanager.facebook.com') return true
  if (url.hostname === 'business.facebook.com') return true
  return url.hostname === 'www.facebook.com' && url.pathname.startsWith('/adsmanager/')
}

function inspect(raw: string): Row | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const { safePath, pageType } = sanitisePath(raw)
  return {
    url: raw,
    host: url.hostname,
    hostAllowed: hostAllowed(url),
    accountId: extractAccountId(raw),
    safePath,
    pageType,
  }
}

/** Điều gì sẽ xảy ra trên thực tế, nói bằng tiếng người. */
function verdict(row: Row): { ok: boolean; text: string } {
  if (!row.hostAllowed) {
    return {
      ok: false,
      text: `content script KHÔNG chạy trên host này (${row.host}) — manifest không khớp`,
    }
  }
  if (row.pageType === 'unknown') {
    return { ok: false, text: 'route KHÔNG có trong allowlist → báo "trang không hỗ trợ"' }
  }
  if (!row.accountId) {
    return { ok: false, text: `route nhận ra (${row.pageType}) nhưng KHÔNG tìm thấy account id → "chưa rõ"` }
  }
  return { ok: true, text: `nhận ra: ${row.pageType}, account ${row.accountId}` }
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a.trim())
  const stdin = args.length ? '' : readFileSync(0, 'utf8')
  const inputs = (args.length ? args : stdin.split('\n'))
    .map((s) => s.trim())
    .filter((s) => s.startsWith('http'))

  if (!inputs.length) {
    console.error('Không có URL nào. Dán URL Ads Manager thật vào stdin hoặc truyền làm tham số.')
    process.exit(2)
  }

  let good = 0
  for (const raw of inputs) {
    const row = inspect(raw)
    if (!row) {
      console.log(`\n✗ ${raw}\n  không phải URL hợp lệ`)
      continue
    }
    const v = verdict(row)
    if (v.ok) good += 1
    console.log(`\n${v.ok ? '✓' : '✗'} ${row.url}`)
    console.log(`  host        ${row.host} ${row.hostAllowed ? '(khớp manifest)' : '(KHÔNG khớp)'}`)
    console.log(`  route       ${row.safePath ?? '— không nhận ra —'}`)
    console.log(`  loại trang  ${row.pageType}`)
    console.log(`  account id  ${row.accountId ?? '— không thấy —'}`)
    console.log(`  → ${v.text}`)
  }

  console.log(`\n${'—'.repeat(60)}`)
  console.log(`${good}/${inputs.length} URL được nhận ra đầy đủ.`)
  if (good < inputs.length) {
    console.log('Các dòng ✗ là allowlist cần bổ sung — gửi lại nguyên văn để sửa PATH_RULES.')
  }
}

main()
