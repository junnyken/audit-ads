import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, ShieldCheck, Sparkles, Wand2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { generateDesktopWarmupVariants, scanDesktopAdPolicy, type PolicyMode } from '@/lib/policy-scanner'

export interface PolicyPreCheckPanelProps {
  compact?: boolean
  mode?: PolicyMode
  initialText?: string
  initialHeadline?: string
  pageName?: string
  category?: string
  isNewPage?: boolean
  onApplyText?: (nextText: string, nextHeadline?: string) => void
  onClose?: () => void
}

export function PolicyPreCheckPanel({
  compact = false,
  mode: initialMode = 'ad_copy',
  initialText = '',
  initialHeadline = '',
  pageName = 'Fanpage Thương hiệu',
  category = 'Dịch vụ & Tư vấn',
  isNewPage = false,
  onApplyText,
  onClose,
}: PolicyPreCheckPanelProps) {
  const [mode, setMode] = useState<PolicyMode>(initialMode)
  const [headline, setHeadline] = useState(initialHeadline)
  const [text, setText] = useState(initialText)
  const [variants, setVariants] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  useEffect(() => {
    if (compact && initialText !== text) {
      setText(initialText)
    }
    // Sync controlled compact box when parent template changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText, compact])

  const scan = useMemo(
    () =>
      scanDesktopAdPolicy(text, {
        headline: mode === 'ad_copy' ? headline : '',
        mode,
        isNewPage: isNewPage || mode === 'page_warmup',
      }),
    [text, headline, mode, isNewPage],
  )

  const badgeVariant =
    scan.verdict === 'safe' ? 'success' : scan.verdict === 'warning' ? 'warning' : 'destructive'

  const verdictLabel =
    scan.verdict === 'safe'
      ? 'Chuẩn chính sách Meta'
      : scan.verdict === 'warning'
        ? 'Cần tinh chỉnh câu từ'
        : 'Nguy cơ cao khóa TKQC / Page'

  const handleCleanRules = () => {
    setText(scan.sanitizedText)
    if (scan.sanitizedHeadline && mode === 'ad_copy') {
      setHeadline(scan.sanitizedHeadline)
    }
    if (onApplyText) {
      onApplyText(scan.sanitizedText, scan.sanitizedHeadline || headline)
    }
    setNotice('Đã thay thế tự động các cụm từ vi phạm chính sách bằng Bộ Luật 0đ.')
  }

  return (
    <div className="studio-panel space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              Kiểm duyệt Chính sách Meta Ads (Offline-First 0đ)
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Quét tức thời 7 nhóm lỗi gây Đỏ Page / Vô hiệu hóa TKQC &amp; sinh bài nuôi Fanpage chuẩn Trust.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant}>
            {scan.score}/100 · {verdictLabel}
          </Badge>
          {onClose && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Đóng kiểm duyệt">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {!compact && (
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('ad_copy')}
            className={`rounded-md px-3 py-1 font-medium transition ${
              mode === 'ad_copy' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Bài chạy Ads (Headline + Primary Text)
          </button>
          <button
            type="button"
            onClick={() => setMode('page_warmup')}
            className={`rounded-md px-3 py-1 font-medium transition ${
              mode === 'page_warmup' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Bài nuôi Fanpage mới (Warm-up Trust)
          </button>
        </div>
      )}

      {mode === 'ad_copy' && !compact && (
        <div className="space-y-1.5">
          <Label className="text-xs">Tiêu đề quảng cáo (Headline)</Label>
          <Input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="VD: Giải pháp chăm sóc da dịu nhẹ mỗi ngày..."
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">
          {mode === 'page_warmup'
            ? 'Nội dung bài mồi nuôi Page (kiểm tra SĐT/Link bán hàng cứng)'
            : 'Nội dung bài viết quảng cáo cần kiểm duyệt (Primary Text)'}
        </Label>
        <Textarea
          rows={compact ? 3 : 4}
          value={text}
          onChange={(e) => {
            const next = e.target.value
            setText(next)
            if (compact && onApplyText) onApplyText(next, headline)
          }}
          placeholder="Dán nội dung bài Ads hoặc bài nuôi Page để quét ngay 7 nhóm lỗi Meta..."
          className="text-xs"
        />
      </div>

      {scan.findings.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/35 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span>Phát hiện {scan.findings.length} điểm có nguy cơ vi phạm:</span>
          </div>
          <ul className="space-y-1.5">
            {scan.findings.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded border border-border/75 bg-background px-2.5 py-1.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={f.severity === 'high' ? 'destructive' : 'warning'}>{f.categoryLabel}</Badge>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                      {f.matchedText}
                    </code>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{f.reason}</p>
                </div>
                {f.safeReplacement && !f.safeReplacement.startsWith('(') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 shrink-0 text-[11px]"
                    onClick={() => {
                      const next = text.replace(f.matchedText, f.safeReplacement)
                      setText(next)
                      if (onApplyText) onApplyText(next, headline)
                    }}
                  >
                    Thay gợi ý sạch
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : text.trim() ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs font-medium text-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <span>Không phát hiện từ khóa vi phạm chính sách Meta Ads.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          {scan.findings.length > 0 && (
            <Button type="button" size="sm" variant="secondary" className="h-8 text-xs" onClick={handleCleanRules}>
              <Wand2 className="h-3.5 w-3.5" /> Làm sạch nhanh (Luật 0đ)
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => {
              const generated = generateDesktopWarmupVariants(pageName, category)
              setVariants(generated)
              setNotice(`Đã sinh ${generated.length} mẫu bài nuôi Fanpage chuẩn Trust (0đ).`)
            }}
          >
            <Sparkles className="h-3.5 w-3.5" /> Sinh 3 bài nuôi Page sạch
          </Button>
        </div>

        {onApplyText && text.trim() && (
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              onApplyText(text, headline)
              setNotice('Đã đưa nội dung sạch vào trình soạn thảo Fanpage.')
            }}
          >
            Đưa vào Caption Spintax
          </Button>
        )}
      </div>

      {notice && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-foreground">
          {notice}
        </div>
      )}

      {variants.length > 0 && (
        <div className="grid gap-2 border-t border-border/70 pt-2.5 md:grid-cols-3">
          {variants.map((v, idx) => (
            <div key={idx} className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-muted/25 p-2.5 text-xs">
              <p className="whitespace-pre-line text-foreground">{v}</p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(v)
                    setCopiedIdx(idx)
                    setTimeout(() => setCopiedIdx(null), 1500)
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {copiedIdx === idx ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedIdx === idx ? 'Đã chép' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setText(v)
                    if (onApplyText) onApplyText(v, headline)
                  }}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Áp dụng #{idx + 1}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
