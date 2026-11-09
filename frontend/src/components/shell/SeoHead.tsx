import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../../i18n'
import { useAuth } from '../../hooks/useAuth'

const ROUTE_TITLES_VI: Record<string, string> = {
  '/': 'AdsOps Control Center — Hệ thống Quản trị Tài khoản Quảng cáo Meta, BM, Via, Fanpage & Quyết toán Agency',
  '/accounts': 'Quản lý Tài khoản Quảng cáo (TKQC) | AdsOps Control Center',
  '/retainers': 'Theo dõi Ngân sách Cam kết & Quyết toán Khách hàng | AdsOps Control Center',
  '/business-managers': 'Quản trị Business Manager (BM Trung tâm & Partner) | AdsOps Control Center',
  '/pages': 'Trung tâm Quản trị Fanpage & Cách ly TKQC | AdsOps Control Center',
  '/assets': 'Quản trị Tài sản Meta (Page · Pixel · Thẻ · Hồ sơ Chrome · Proxy) | AdsOps Control Center',
  '/facebook-accounts': 'Quản lý Dàn Via 3 Tầng, OTP 2FA & Hồ sơ Chrome | AdsOps Control Center',
  '/chrome-extension': 'Tiện ích Google Chrome AdsOps Companion (.zip) | AdsOps Control Center',
  '/alerts': 'Cảnh báo Rủi ro & Kiểm toán An toàn Meta | AdsOps Control Center',
  '/operations': 'Trung tâm Tác vụ & Chia sẻ Tài sản Hàng loạt | AdsOps Control Center',
  '/operations-guide': 'Cẩm nang Quy trình Vận hành Agency & Chống Chết Liên Đới | AdsOps Control Center',
  '/team': 'Phân quyền Nhân sự & Ghế Thành viên | AdsOps Control Center',
  '/settings': 'Cài đặt Hệ thống & Kết nối Meta Graph API | AdsOps Control Center',
}

const ROUTE_TITLES_EN: Record<string, string> = {
  '/': 'AdsOps Control Center — Meta Ad Account Governance, BM, Via, Fanpage & Agency Billing Suite',
  '/accounts': 'Ad Accounts Registry & Live Spend | AdsOps Control Center',
  '/retainers': 'Client Retainers, Budget Pacing & Monthly Settlement | AdsOps Control Center',
  '/business-managers': 'Business Managers (Tier-1 Asset Vault & Partner BMs) | AdsOps Control Center',
  '/pages': 'Fanpage Control Center & Ad Account Isolation | AdsOps Control Center',
  '/assets': 'Meta Assets Governance (Pages · Pixels · Cards · Chrome · Proxy) | AdsOps Control Center',
  '/facebook-accounts': '3-Tier Facebook Vias, Live 2FA OTP & Chrome Profiles | AdsOps Control Center',
  '/chrome-extension': 'AdsOps Companion Google Chrome Extension (.zip) | AdsOps Control Center',
  '/alerts': 'Risk Alerts & Anti-Contagion Audit | AdsOps Control Center',
  '/operations': 'Batch Operations & Partner Asset Sharing | AdsOps Control Center',
  '/operations-guide': 'Agency Playbook & Anti-Chain-Ban Operating Guide | AdsOps Control Center',
  '/team': 'Team Seats & Role-Based Access Control | AdsOps Control Center',
  '/settings': 'Workspace Settings & Meta Graph API Connections | AdsOps Control Center',
}

export function SeoHead() {
  const location = useLocation()
  const { language } = useI18n()
  const { user } = useAuth()
  const isEn = language === 'en'

  useEffect(() => {
    const doc = document
    doc.documentElement.lang = isEn ? 'en' : 'vi'

    const path = location.pathname || '/'
    const titleMap = isEn ? ROUTE_TITLES_EN : ROUTE_TITLES_VI
    const matchedTitle =
      titleMap[path] ??
      (isEn
        ? 'AdsOps Control Center — Meta Ad Account Governance & Agency Billing Platform'
        : 'AdsOps Control Center — Hệ thống Quản trị Tài khoản Quảng cáo Meta & Quyết toán Agency')
    doc.title = matchedTitle

    // Dynamic Canonical URL & og:url (automatically adapts when custom domain is changed!)
    const origin = window.location.origin
    const canonicalHref = `${origin}${path === '/' ? '/' : path}`

    let canonicalEl = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
    if (!canonicalEl) {
      canonicalEl = doc.createElement('link')
      canonicalEl.setAttribute('rel', 'canonical')
      doc.head.appendChild(canonicalEl)
    }
    canonicalEl.setAttribute('href', canonicalHref)

    let ogUrlEl = doc.querySelector('meta[property="og:url"]') as HTMLMetaElement | null
    if (!ogUrlEl) {
      ogUrlEl = doc.createElement('meta')
      ogUrlEl.setAttribute('property', 'og:url')
      doc.head.appendChild(ogUrlEl)
    }
    ogUrlEl.setAttribute('content', canonicalHref)

    // Public landing page is indexable; authenticated workspace pages are private
    let robotsEl = doc.querySelector('meta[name="robots"]') as HTMLMetaElement | null
    if (!robotsEl) {
      robotsEl = doc.createElement('meta')
      robotsEl.setAttribute('name', 'robots')
      doc.head.appendChild(robotsEl)
    }
    if (!user || path === '/login') {
      robotsEl.setAttribute(
        'content',
        'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
      )
    } else {
      robotsEl.setAttribute('content', 'noindex, nofollow')
    }
  }, [location.pathname, isEn, user])

  return null
}
