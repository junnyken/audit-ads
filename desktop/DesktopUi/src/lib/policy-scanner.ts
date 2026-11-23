export type PolicyMode = 'ad_copy' | 'page_warmup'
export type PolicyVerdict = 'safe' | 'warning' | 'high_risk'

export interface PolicyFinding {
  id: string
  category: string
  categoryLabel: string
  severity: 'high' | 'medium'
  matchedText: string
  reason: string
  safeReplacement: string
}

export interface PolicyScanResult {
  score: number
  verdict: PolicyVerdict
  mode: PolicyMode
  findingsCount: number
  findings: PolicyFinding[]
  sanitizedText: string
  sanitizedHeadline: string
}

interface LocalRule {
  id: string
  category: string
  categoryLabel: string
  severity: 'high' | 'medium'
  pattern: RegExp
  reason: string
  replacement: string
}

const LOCAL_RULES: LocalRule[] = [
  {
    id: 'med_absolute_cure',
    category: 'medical_exaggeration',
    categoryLabel: 'Cam kết tuyệt đối & Y khoa',
    severity: 'high',
    pattern:
      /(?<![\p{L}\p{N}_])(?:cam\s*kết\s*100%|hiệu\s*quả\s*100%|chữa\s*khỏi\s*hoàn\s*toàn|dứt\s*điểm\s*vĩnh\s*viễn|trị\s*tận\s*gốc|bác\s*sĩ\s*cam\s*kết|cam\s*kết\s*không\s*tái\s*phát|100%\s*guaranteed\s*cure|permanent\s*cure|guaranteed\s*results)(?![\p{L}\p{N}_])/giu,
    reason: "Meta cấm khẳng định kết quả y khoa/thẩm mỹ tuyệt đối 100% hoặc 'dứt điểm vĩnh viễn'.",
    replacement: 'hỗ trợ cải thiện rõ rệt theo lộ trình chăm sóc phù hợp',
  },
  {
    id: 'personal_attr_shame',
    category: 'personal_attributes',
    categoryLabel: 'Ám chỉ đặc điểm cá nhân',
    severity: 'high',
    pattern:
      /(?<![\p{L}\p{N}_])(?:bạn\s*đang\s*béo|bụng\s*mỡ\s*của\s*bạn|da\s*bạn\s*đầy\s*mụn|mặt\s*(?:bạn\s*)?nhiều\s*nám(?:\s*sạm)?|bạn\s*đang\s*nợ\s*nần|bạn\s*bị\s*hói|are\s*you\s*overweight|suffering\s*from\s*acne|is\s*your\s*skin\s*aging)(?![\p{L}\p{N}_])/giu,
    reason: "Chính sách Meta Personal Attributes cấm nói trực diện vào ngoại hình, bệnh lý hay tài chính của 'bạn'.",
    replacement: 'nhiều khách hàng đang tìm kiếm giải pháp chăm sóc phù hợp',
  },
  {
    id: 'before_after_rapid',
    category: 'before_after_rapid',
    categoryLabel: 'Before/After & Cam kết cấp tốc',
    severity: 'high',
    pattern:
      /(?<![\p{L}\p{N}_])(?:giảm\s*\d+\s*kg\s*trong\s*\d+\s*(?:ngày|tuần)|trắng\s*bật\s*\d+\s*tông|hết\s*sạch\s*mụn\s*sau\s*\d+\s*ngày|before\s*(?:&|and)\s*after|trước\s*và\s*sau\s*khi\s*dùng|lose\s*\d+\s*(?:kg|lbs)\s*in\s*\d+\s*days)(?![\p{L}\p{N}_])/giu,
    reason: 'Quảng cáo so sánh Trước/Sau hoặc hứa làm đẹp/giảm cân cấp tốc theo số ngày dễ khóa TKQC.',
    replacement: 'chăm sóc đều đặn kết hợp chế độ sinh hoạt cân bằng',
  },
  {
    id: 'financial_claims',
    category: 'financial_claims',
    categoryLabel: 'Tài chính & Cam kết thu nhập',
    severity: 'high',
    pattern:
      /(?<![\p{L}\p{N}_])(?:giải\s*ngân\s*trong\s*\d+\s*phút|bao\s*đậu\s*nợ\s*xấu|cam\s*kết\s*lợi\s*nhuận|việc\s*nhẹ\s*lương\s*cao|kiếm\s*\d+\s*triệu\s*\/\s*(?:ngày|tuần)|guaranteed\s*profit|get\s*rich\s*quick)(?![\p{L}\p{N}_])/giu,
    reason: 'Nội dung hứa hẹn lợi nhuận, việc nhẹ lương cao hoặc giải ngân cấp tốc bị xếp vào rủi ro tài chính cao.',
    replacement: 'quy trình tư vấn minh bạch với thông tin điều kiện rõ ràng',
  },
  {
    id: 'restricted_counterfeit',
    category: 'restricted_products_trademark',
    categoryLabel: 'Hàng nhái & Sản phẩm hạn chế',
    severity: 'high',
    pattern:
      /(?<![\p{L}\p{N}_])(?:hàng\s*rep\s*1\s*:\s*1|like\s*auth|super\s*fake|thuốc\s*kích|cờ\s*bạc|cá\s*độ|tài\s*xỉu)(?![\p{L}\p{N}_])/giu,
    reason: 'Từ khóa ám chỉ hàng giả, hàng nhái thương hiệu hoặc sản phẩm cấm dẫn tới vô hiệu hóa TKQC tức thì.',
    replacement: 'sản phẩm thiết kế chính hãng có nguồn gốc rõ ràng',
  },
]

const CAPS_WORD_RE = /(?<![\p{L}\p{N}_])[\p{Lu}]{4,}(?![\p{L}\p{N}_])/gu
const PUNCT_BURST_RE = /[!?]{3,}/g
const SHORTENER_RE = /https?:\/\/(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl)\/\S+/gi
const ENGAGEMENT_BAIT_RE =
  /(?<![\p{L}\p{N}_])(?:share\s*ngay\s*để\s*nhận|comment\s*chấm\s*để|bình\s*luận\s*chấm\s*\(?\.?\)?\s*để)(?![\p{L}\p{N}_])/giu
const HARD_SELL_RE = /(?:\b0\d{9}\b|\+84\d{9}\b|https?:\/\/\S+|(?<![\p{L}\p{N}_])(?:inbox\s*ngay|giá\s*chỉ\s*\d+k)(?![\p{L}\p{N}_]))/giu

export function scanDesktopAdPolicy(
  text: string,
  opts?: { headline?: string; mode?: PolicyMode; isNewPage?: boolean },
): PolicyScanResult {
  const mode: PolicyMode = opts?.mode === 'page_warmup' ? 'page_warmup' : 'ad_copy'
  const isNewPage = Boolean(opts?.isNewPage)
  const cleanText = (text || '').trim()
  const cleanHeadline = (opts?.headline || '').trim()
  const combined = cleanHeadline ? `${cleanHeadline}\n${cleanText}`.trim() : cleanText

  const findings: PolicyFinding[] = []
  let sanitizedText = cleanText
  let sanitizedHeadline = cleanHeadline
  let penalty = 0

  for (const rule of LOCAL_RULES) {
    const seen = new Set<string>()
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`
    const re = new RegExp(rule.pattern.source, flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(combined)) !== null) {
      const snippet = m[0].trim()
      const key = snippet.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        findings.push({
          id: `${rule.id}:${findings.length + 1}`,
          category: rule.category,
          categoryLabel: rule.categoryLabel,
          severity: rule.severity,
          matchedText: snippet,
          reason: rule.reason,
          safeReplacement: rule.replacement,
        })
        penalty += rule.severity === 'high' ? 22 : 12
      }
    }
    sanitizedText = sanitizedText.replace(new RegExp(rule.pattern.source, flags), rule.replacement)
    if (sanitizedHeadline) {
      sanitizedHeadline = sanitizedHeadline.replace(new RegExp(rule.pattern.source, flags), rule.replacement)
    }
  }

  const capsWords = combined.match(CAPS_WORD_RE) ?? []
  if (capsWords.length >= 4) {
    findings.push({
      id: `engagement_spam_caps:${findings.length + 1}`,
      category: 'engagement_spam_format',
      categoryLabel: 'Định dạng Spam & Câu tương tác',
      severity: 'medium',
      matchedText: capsWords.slice(0, 4).join(' '),
      reason: `Phát hiện ${capsWords.length} từ VIẾT HOA liên tiếp — dễ bị bộ lọc Spam của Meta giảm phân phối.`,
      safeReplacement: 'viết hoa chuẩn câu chữ tự nhiên',
    })
    penalty += 10
    sanitizedText = sanitizedText.replace(CAPS_WORD_RE, (w) => w[0] + w.slice(1).toLowerCase())
  }

  const punctMatch = combined.match(PUNCT_BURST_RE)
  if (punctMatch) {
    findings.push({
      id: `engagement_spam_punct:${findings.length + 1}`,
      category: 'engagement_spam_format',
      categoryLabel: 'Định dạng Spam & Câu tương tác',
      severity: 'medium',
      matchedText: punctMatch[0],
      reason: "Lạm dụng nhiều dấu '!!!' hoặc '???' liên tiếp kích hoạt cảnh báo nội dung giật gân.",
      safeReplacement: '.',
    })
    penalty += 8
    sanitizedText = sanitizedText.replace(PUNCT_BURST_RE, '.')
  }

  const shortMatch = combined.match(SHORTENER_RE)
  if (shortMatch) {
    findings.push({
      id: `engagement_spam_shortlink:${findings.length + 1}`,
      category: 'engagement_spam_format',
      categoryLabel: 'Định dạng Spam & Câu tương tác',
      severity: 'high',
      matchedText: shortMatch[0],
      reason: 'Link rút gọn (bit.ly / tinyurl) trong bài quảng cáo thường bị đánh dấu che giấu đích đến.',
      safeReplacement: 'domain chính chủ của thương hiệu',
    })
    penalty += 18
  }

  if (mode === 'ad_copy') {
    const baitMatch = combined.match(ENGAGEMENT_BAIT_RE)
    if (baitMatch) {
      findings.push({
        id: `engagement_bait:${findings.length + 1}`,
        category: 'engagement_spam_format',
        categoryLabel: 'Định dạng Spam & Câu tương tác',
        severity: 'medium',
        matchedText: baitMatch[0],
        reason: "Kêu gọi 'share ngay / comment chấm' bị thuật toán Meta xếp vào Engagement Bait (bóp reach).",
        safeReplacement: 'nhắn tin hoặc để lại thông tin để được đội ngũ hỗ trợ chi tiết',
      })
      penalty += 12
      sanitizedText = sanitizedText.replace(
        ENGAGEMENT_BAIT_RE,
        'nhắn tin để được đội ngũ hỗ trợ chi tiết',
      )
    }
  }

  if (mode === 'page_warmup' || isNewPage) {
    const sellMatch = combined.match(HARD_SELL_RE)
    if (sellMatch) {
      findings.push({
        id: `new_page_hard_sell:${findings.length + 1}`,
        category: 'new_page_hard_sell',
        categoryLabel: 'Bán hàng cứng trên Page mới',
        severity: 'medium',
        matchedText: sellMatch[0],
        reason: 'Bài mồi nuôi Fanpage mới chưa nên chèn SĐT, link mua hàng hoặc báo giá quá sớm để tránh quét Page thương mại ảo.',
        safeReplacement: '(gỡ SĐT/Link bán hàng trong giai đoạn 3 bài mồi đầu)',
      })
      penalty += 14
      sanitizedText = sanitizedText.replace(HARD_SELL_RE, '').trim()
    }
  }

  const score = Math.max(0, Math.min(100, 100 - penalty))
  const verdict: PolicyVerdict =
    score >= 85 && !findings.some((f) => f.severity === 'high')
      ? 'safe'
      : score >= 60
        ? 'warning'
        : 'high_risk'

  return {
    score,
    verdict,
    mode,
    findingsCount: findings.length,
    findings,
    sanitizedText: sanitizedText.replace(/\s{2,}/g, ' ').trim(),
    sanitizedHeadline,
  }
}

export function generateDesktopWarmupVariants(pageName = 'Thương hiệu', category = 'Dịch vụ & Tư vấn'): string[] {
  const brand = (pageName || 'Thương hiệu').trim()
  const niche = (category || 'Dịch vụ & Tư vấn').trim()
  return [
    `Chào tuần mới thật nhiều năng lượng! Hôm nay ${brand} tổng hợp nhanh 3 thói quen nhỏ mỗi ngày giúp nâng cao trải nghiệm trong lĩnh vực ${niche}. Cả nhà thường bắt đầu buổi sáng với thói quen nào?`,
    `Góc chia sẻ kinh nghiệm thực tế từ đội ngũ ${brand}: để duy trì chất lượng ổn định, khâu kiểm tra định kỳ và lắng nghe phản hồi luôn được ưu tiên hàng đầu. Chúc mọi người một ngày làm việc hiệu quả.`,
    `Nhật ký hậu trường chuẩn bị cho những dự án mới tại ${brand}. Cảm ơn sự đồng hành của cộng đồng trong suốt thời gian qua — hẹn gặp mọi người trong chuỗi nội dung chia sẻ tuần tới.`,
  ]
}
