/**
 * Vietnamese strings — the source of truth for every translation key (U1a).
 *
 * `en.ts` is checked against this file's keys at compile time (see `types.ts`), so a key added
 * here without an English counterpart fails `tsc -b` instead of shipping half-translated.
 * Same pattern as `extension/src/shared/i18n`.
 *
 * WORDING STATUS — every string below that is new to the dashboard is
 * `[ĐỀ XUẤT — chờ duyệt]` (proposed, awaiting BA review). Wording belongs to the BA
 * (docs/AUDIT_BEFORE_BUILD_U1_UI.md §1, Q8). Strings reused from the extension's `vi.ts` are
 * marked [TÁI DÙNG]; they already shipped and keep the same wording.
 *
 *   [ĐỀ XUẤT — chờ duyệt]  common.*, shell.*, nav.group.*, nav.item.*, theme.*, language.*,
 *                          user.*, role.*, login.*, format.*
 *   [TÁI DÙNG]             common.appName (name kept untranslated), language.vi/en short codes
 *
 * Guardrails for the copy: nothing here may say an account is safe, cannot be restricted, or
 * will be approved (CLAUDE.md rule 6); the disclaimer keeps the meaning of READINESS_DISCLAIMER.
 */
export const vi = {
  'common.appName': 'AdsOps Control Center',
  'common.appTagline': 'Sổ đăng ký tài khoản và mức sẵn sàng vận hành',
  'common.loading': 'Đang tải…',

  'shell.skipToContent': 'Bỏ qua thanh điều hướng, tới nội dung chính',
  'shell.mainNavLabel': 'Điều hướng chính',
  'shell.openMenu': 'Mở menu điều hướng',
  'shell.closeMenu': 'Đóng menu điều hướng',
  'shell.menuTitle': 'Menu điều hướng',
  'shell.workspace': 'Không gian làm việc',
  'shell.disclaimer':
    'Mức sẵn sàng là trạng thái vận hành nội bộ, suy ra từ bằng chứng đã ghi nhận. Đó không phải là sự phê duyệt của nền tảng và không bảo đảm tài khoản tránh được hạn chế.',

  'nav.group.overview': 'Tổng quan',
  'nav.group.accounts': 'Tài khoản',
  'nav.group.monitoring': 'Theo dõi',
  'nav.group.operations': 'Vận hành',
  'nav.group.meta': 'Kết nối Meta',
  'nav.group.teamSecurity': 'Đội & bảo mật',
  'nav.group.system': 'Hệ thống',

  'nav.item.overview': 'Tổng quan',
  'nav.item.accounts': 'Tài khoản quảng cáo',
  'nav.item.businessManagers': 'Business Manager',
  'nav.item.assets': 'Tài sản',
  'nav.item.accountHealth': 'Sức khoẻ tài khoản',
  'nav.item.readiness': 'Mức sẵn sàng',
  'nav.item.alerts': 'Cảnh báo',
  'nav.item.preflight': 'Kiểm tra trước khi chạy',
  'nav.item.operations': 'Vận hành',
  'nav.item.metaConnections': 'Kết nối Meta',
  'nav.item.team': 'Thành viên',
  'nav.item.securityDevices': 'Thiết bị đăng nhập',
  'nav.item.auditLog': 'Nhật ký kiểm toán',
  'nav.item.settings': 'Cài đặt',
  'nav.item.systemStatus': 'Trạng thái hệ thống',

  'theme.label': 'Giao diện sáng/tối',
  'theme.system': 'Theo hệ thống',
  'theme.light': 'Sáng',
  'theme.dark': 'Tối',

  'language.label': 'Ngôn ngữ',
  'language.vi': 'Tiếng Việt',
  'language.en': 'English',
  'language.shortVi': 'VI',
  'language.shortEn': 'EN',

  'user.menuLabel': 'Tài khoản người dùng',
  'user.signedInAs': 'Đăng nhập với',
  'user.signOut': 'Đăng xuất',
  'role.owner': 'Chủ workspace',
  'role.operator': 'Người vận hành',
  'role.viewer': 'Người xem',
  'role.auditor': 'Kiểm toán viên',

  'login.title': 'Đăng nhập',
  'login.email': 'Email',
  'login.password': 'Mật khẩu',
  'login.submit': 'Đăng nhập',
  'login.submitting': 'Đang đăng nhập…',
  'login.failed': 'Không đăng nhập được. Hãy thử lại hoặc liên hệ chủ workspace.',

  'format.never': 'chưa từng',
  'format.justNow': 'vừa xong',
} as const
