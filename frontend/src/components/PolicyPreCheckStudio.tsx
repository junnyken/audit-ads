import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { Badge } from './primitives/badge'
import { Button } from './primitives/button'
import { aiStudioApi, scanAdPolicyLocal, type PolicyMode } from '../lib/policyScanner'

export interface PolicyPreCheckStudioProps {
  compact?: boolean
  initialText?: string
  initialHeadline?: string
  pageName?: string
  category?: string
  mode?: PolicyMode
  isNewPage?: boolean
  onApplyText?: (nextText: string, nextHeadline?: string) => void
  onClose?: () => void
}

export function PolicyPreCheckStudio({
  compact = false,
  initialText = '',
  initialHeadline = '',
  pageName = '',
  category = '',
  mode: initialMode = 'ad_copy',
  isNewPage = false,
  onApplyText,
  onClose,
}: PolicyPreCheckStudioProps) {
  const [mode, setMode] = useState<PolicyMode>(initialMode)
  const [headline, setHeadline] = useState(initialHeadline)
  const [text, setText] = useState(initialText)
  const [variants, setVariants] = useState<string[]>([])
  const [engineUsed, setEngineUsed] = useState<'workspace_ai' | 'deterministic_rules' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  useEffect(() => {
    if (compact && initialText !== text) {
      setText(initialText)
    }
    // Sync controlled compact box when parent template changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText, compact])

  const aiConfigQ = useQuery({
    queryKey: ['workspace-ai-studio-config'],
    queryFn: aiStudioApi.getConfig,
    retry: false,
  })

  const scan = useMemo(
    () =>
      scanAdPolicyLocal(text, {
        headline: mode === 'ad_copy' ? headline : '',
        mode,
        isNewPage: isNewPage || mode === 'page_warmup',
      }),
    [text, headline, mode, isNewPage],
  )

  const rewriteMut = useMutation({
    mutationFn: () =>
      aiStudioApi.generate({
        task: 'rewrite_safe',
        text,
        headline: mode === 'ad_copy' ? headline : '',
        page_name: pageName,
        category,
        mode,
      }),
    onSuccess: (res) => {
      setEngineUsed(res.engine)
      setVariants(res.variants ?? [res.rewritten_text])
      if (res.rewritten_text) {
        setText(res.rewritten_text)
        if (onApplyText) onApplyText(res.rewritten_text, res.rewritten_headline ?? headline)
      }
      if (res.rewritten_headline !== undefined && mode === 'ad_copy') {
        setHeadline(res.rewritten_headline)
      }
      setNotice(
        res.ai_fallback_reason
          ? `AI đang tạm gián đoạn (${res.ai_fallback_reason}) — Đã làm sạch bằng Bộ Luật Chính Sách 0đ.`
          : res.engine === 'workspace_ai'
            ? `AI (${res.provider}/${res.model}) đã viết lại bài đạt ${res.after_score}/100 điểm an toàn.`
            : `Đã tự động thay thế các cụm vi phạm (Điểm: ${res.before_score ?? scan.score} -> ${res.after_score}/100).`,
      )
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : 'Không thể gọi dịch vụ kiểm duyệt.')
    },
  })

  const warmupGenMut = useMutation({
    mutationFn: () =>
      aiStudioApi.generate({
        task: 'page_warmup',
        page_name: pageName || 'Thương hiệu',
        category: category || 'Dịch vụ & Tư vấn',
        mode: 'page_warmup',
      }),
    onSuccess: (res) => {
      setEngineUsed(res.engine)
      const list = res.variants && res.variants.length > 0 ? res.variants : [res.rewritten_text]
      setVariants(list)
      setNotice(
        res.engine === 'workspace_ai'
          ? `AI (${res.provider}/${res.model}) đã tạo ${list.length} mẫu bài nuôi Page tự nhiên.`
          : `Đã sinh ${list.length} mẫu bài nuôi Fanpage chuẩn Trust (0đ, không mùi quảng cáo cứng).`,
      )
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : 'Không thể tạo bài nuôi Page.')
    },
  })

  const scoreTone =
    scan.verdict === 'safe' ? 'positive' : scan.verdict === 'warning' ? 'caution' : 'attention'

  const verdictLabel =
    scan.verdict === 'safe'
      ? 'Chuẩn chính sách Meta'
      : scan.verdict === 'warning'
        ? 'Cần tinh chỉnh câu từ'
        : 'Nguy cơ cao khóa TKQC / Page'

  const aiCfg = aiConfigQ.data

  const handleApplyCleanRule = () => {
    setText(scan.sanitized_text)
    if (scan.sanitized_headline && mode === 'ad_copy') {
      setHeadline(scan.sanitized_headline)
    }
    if (onApplyText) {
      onApplyText(scan.sanitized_text, scan.sanitized_headline || headline)
    }
    setNotice('Đã áp dụng thay thế tự động toàn bộ cụm từ rủi ro (Bộ Luật 0đ).')
  }

  return (
    <section
      aria-label="Kiểm duyệt Chính sách & AI Content Studio"
      className="rounded-xl border border-line bg-surface p-4 shadow-xs space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-brand-text" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold text-ink">
              Kiểm duyệt Chính sách Meta Ads &amp; AI Content Studio
            </h3>
            <p className="text-[11px] text-ink-muted">
              Quét tức thời 7 nhóm lỗi gây Đỏ Page / Vô hiệu hóa TKQC (0đ) + BYOK AI viết lại sạch chính sách.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={scoreTone}>
            Điểm An toàn: {scan.score}/100 · {verdictLabel}
          </Badge>
          {aiCfg?.key_configured && aiCfg.enabled ? (
            <Badge tone="info">
              AI Workspace: {aiCfg.provider}/{aiCfg.model}
            </Badge>
          ) : (
            <Link
              to="/settings#sec-integrations"
              className="rounded border border-line bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-brand-text hover:underline"
            >
              Gắn Key AI (Gemini/OpenAI/Claude)
            </Link>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line px-2 py-0.5 text-xs font-medium text-ink-muted hover:text-ink"
            >
              Đóng
            </button>
          )}
        </div>
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center rounded-lg border border-line bg-surface-sunken p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('ad_copy')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                mode === 'ad_copy' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
              }`}
            >
              Bài chạy Ads (Headline + Primary Text)
            </button>
            <button
              type="button"
              onClick={() => setMode('page_warmup')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                mode === 'page_warmup' ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink'
              }`}
            >
              Bài nuôi Fanpage mới (Warm-up Trust)
            </button>
          </div>
          {engineUsed && (
            <span className="text-[11px] text-ink-muted">
              Nguồn xử lý gần nhất:{' '}
              <strong className="text-ink">
                {engineUsed === 'workspace_ai' ? 'AI Workspace (BYOK)' : 'Bộ Luật Chính Sách (0đ)'}
              </strong>
            </span>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {mode === 'ad_copy' && !compact && (
          <div>
            <label className="label text-xs" htmlFor="policy-headline-input">
              Tiêu đề quảng cáo (Headline)
            </label>
            <input
              id="policy-headline-input"
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="VD: Giải pháp chăm sóc da dịu nhẹ mỗi ngày cho văn phòng..."
              className="input text-xs"
            />
          </div>
        )}

        <div>
          <label className="label text-xs" htmlFor="policy-body-input">
            {mode === 'page_warmup'
              ? 'Nội dung bài đăng nuôi Fanpage (Kiểm tra theo chuẩn Page mới)'
              : 'Nội dung bài viết quảng cáo cần kiểm duyệt (Primary Text)'}
          </label>
          <textarea
            id="policy-body-input"
            rows={compact ? 3 : 4}
            value={text}
            onChange={(e) => {
              const next = e.target.value
              setText(next)
              if (compact && onApplyText) onApplyText(next, headline)
            }}
            placeholder={
              mode === 'page_warmup'
                ? 'Nhập nội dung bài nuôi Page để kiểm tra SĐT/Link bán hàng cứng hoặc từ khóa nhạy cảm...'
                : 'Dán bài viết chạy Meta Ads vào đây để quét ngay lỗi Personal Attributes, Cam kết 100%, Before/After...'
            }
            className="input text-xs"
          />
        </div>
      </div>

      {/* Findings List */}
      {scan.findings.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-tone-caution-border bg-tone-caution-bg p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-tone-caution-fg">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Phát hiện {scan.findings.length} điểm có nguy cơ vi phạm chính sách Meta:</span>
          </div>
          <ul className="space-y-1.5">
            {scan.findings.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded border border-line bg-surface px-2.5 py-2 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={f.severity === 'high' ? 'attention' : 'caution'}>{f.category_label}</Badge>
                    <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] font-semibold text-tone-attention-fg">
                      {f.matched_text}
                    </code>
                  </div>
                  <p className="text-[11px] text-ink-muted">{f.reason}</p>
                </div>
                {f.safe_replacement && !f.safe_replacement.startsWith('(') && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = text.replace(f.matched_text, f.safe_replacement)
                      setText(next)
                      if (onApplyText) onApplyText(next, headline)
                    }}
                    className="shrink-0 rounded border border-line bg-surface-sunken px-2 py-1 text-[11px] font-medium text-brand-text hover:border-line-strong"
                  >
                    Thay bằng gợi ý an toàn
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : text.trim() ? (
        <div className="flex items-center gap-2 rounded-lg border border-tone-positive-border bg-tone-positive-bg px-3 py-2 text-xs font-medium text-tone-positive-fg">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Không phát hiện từ khóa hoặc cấu trúc rủi ro vi phạm chính sách Meta Ads.</span>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {scan.findings.length > 0 && (
            <Button type="button" size="sm" variant="secondary" onClick={handleApplyCleanRule}>
              <span className="inline-flex items-center gap-1.5">
                <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Làm sạch nhanh (Luật 0đ)</span>
              </span>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!text.trim() || rewriteMut.isPending}
            onClick={() => rewriteMut.mutate()}
          >
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {rewriteMut.isPending
                  ? 'Đang viết lại...'
                  : aiCfg?.key_configured && aiCfg.enabled
                    ? 'AI Viết lại chuẩn Chính sách'
                    : 'Chuẩn hóa câu chữ (Server Engine)'}
              </span>
            </span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={warmupGenMut.isPending}
            onClick={() => warmupGenMut.mutate()}
          >
            <span className="inline-flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{warmupGenMut.isPending ? 'Đang sinh bài...' : 'Sinh 3 bài nuôi Page sạch'}</span>
            </span>
          </Button>
        </div>

        {onApplyText && !compact && text.trim() && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onApplyText(text, headline)
              setNotice('Đã đưa nội dung sạch vào trình soạn thảo.')
            }}
          >
            Dùng bài này
          </Button>
        )}
      </div>

      {notice && (
        <div className="rounded-md border border-tone-info-border bg-tone-info-bg px-3 py-2 text-xs font-medium text-tone-info-fg">
          {notice}
        </div>
      )}

      {variants.length > 0 && (
        <div className="space-y-2 border-t border-line pt-2.5">
          <div className="text-xs font-semibold text-ink">Mẫu nội dung gợi ý ({variants.length}):</div>
          <div className="grid gap-2 md:grid-cols-3">
            {variants.map((v, idx) => (
              <div
                key={idx}
                className="flex flex-col justify-between gap-2 rounded-lg border border-line bg-surface-sunken p-2.5 text-xs"
              >
                <p className="whitespace-pre-line text-ink">{v}</p>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(v)
                      setCopiedIdx(idx)
                      setTimeout(() => setCopiedIdx(null), 1500)
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-ink"
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
                    className="text-[11px] font-semibold text-brand-text hover:underline"
                  >
                    Áp dụng mẫu #{idx + 1}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
