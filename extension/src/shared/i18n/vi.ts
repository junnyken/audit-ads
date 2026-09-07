/**
 * Vietnamese strings — the source of truth for every translation key.
 *
 * `en.ts` is checked against this file's keys at compile time (see `types.ts`), so a key added
 * here without an English counterpart fails the build instead of shipping half-translated.
 */
export const vi = {
  'common.loading': 'Đang tải…',
  'common.appTitle': 'AdsOps Control Center',
  'common.refresh': 'Làm mới',
  'common.openSettings': 'Mở cài đặt',
  'common.none': 'Không có',

  'presentation.readiness.operationallyReady.label': 'Sẵn sàng vận hành',
  'presentation.readiness.readyWithWarnings.label': 'Sẵn sàng, có cảnh báo',
  'presentation.readiness.notReady.label': 'Chưa sẵn sàng',
  'presentation.readiness.unknown.label': 'Không xác định',

  'presentation.health.clearSignals.label': 'Hiện không phát hiện vấn đề gì',
  'presentation.health.attentionNeeded.label': 'Cần chú ý',
  'presentation.health.warning.label': 'Cảnh báo',
  'presentation.health.critical.label': 'Nghiêm trọng',
  'presentation.health.unknown.label': 'Không xác định',

  'presentation.freshness.current.label': 'Mới cập nhật',
  'presentation.freshness.stale.label': 'Đã cũ',
  'presentation.freshness.neverEvaluated.label': 'Chưa từng đánh giá',
  'presentation.freshness.notApplicable.label': 'Không áp dụng',

  'presentation.context.confirmed.label': 'Đã xác nhận',
  'presentation.context.confirmed.hint': 'Trang này khớp chính xác với một tài khoản đã đăng ký, theo đúng mã tài khoản.',
  'presentation.context.ambiguous.label': 'Chưa xác nhận',
  'presentation.context.ambiguous.hint': 'Không thể khớp trang này với một tài khoản đã đăng ký một cách chắc chắn.',
  'presentation.context.unknown.label': 'Chưa đăng ký',
  'presentation.context.unknown.hint': 'Không có tài khoản nào đã đăng ký khớp với mã tài khoản trên trang này.',
  'presentation.context.unsupportedPage.label': 'Không phải trang Ads Manager',
  'presentation.context.unsupportedPage.hint': 'Mở một trang Ads Manager để xem thông tin tài khoản.',

  'presentation.event.manualReviewStarted': 'Đã bắt đầu rà soát thủ công',
  'presentation.event.manualReviewCompleted': 'Đã hoàn tất rà soát thủ công',
  'presentation.event.campaignChangeIntent': 'Đã ghi nhận ý định thay đổi',
  'presentation.event.campaignChangeCompleted': 'Đã hoàn tất thay đổi',
  'presentation.event.accountNoteAdded': 'Đã thêm ghi chú',
  'presentation.event.policyIssueReported': 'Đã báo cáo vấn đề chính sách',
  'presentation.event.paymentIssueReported': 'Đã báo cáo vấn đề thanh toán',

  'presentation.guardChecklist.context': 'Ngữ cảnh đã được xác nhận đúng theo mã tài khoản',
  'presentation.guardChecklist.readiness': 'Tôi đã xem xét mức độ sẵn sàng của tài khoản',
  'presentation.guardChecklist.alerts': 'Tôi đã xem xét các cảnh báo nghiêm trọng đang mở',
  'presentation.guardChecklist.reason': 'Tôi đã ghi lại lý do thực hiện thay đổi này',

  'presentation.disclaimer':
    'Đây là các trạng thái vận hành được ghi nhận trong sản phẩm này. Chúng không phải quyết ' +
    'định từ nền tảng quảng cáo, và không đảm bảo rằng tài khoản sẽ không bị hạn chế.',
  'presentation.readOnlyNote':
    'Tiện ích này chỉ đọc trang và hiển thị những gì sản phẩm đã biết. Nó không thay đổi bất kỳ ' +
    'điều gì trong Ads Manager.',

  'popup.notConnected.body': 'Tiện ích chưa được kết nối tới dashboard nào.',
  'popup.openAccount': 'Mở tài khoản',
  'popup.openAlerts': 'Mở cảnh báo',
  'popup.readingContext': 'Đang đọc ngữ cảnh trang…',
  'popup.openDashboard': 'Mở dashboard',
  'popup.selectAccountManually': 'Chọn tài khoản thủ công',

  'contextView.accountId': 'Mã tài khoản',
  'contextView.businessManager': 'Business Manager',
  'contextView.owner': 'Chủ sở hữu',
  'contextView.page': 'Trang',
  'contextView.archivedNotice': 'Tài khoản này đã được lưu trữ và không còn được quản lý chủ động.',
  'contextView.readiness': 'Mức độ sẵn sàng',
  'contextView.health': 'Tình trạng',
  'contextView.dataFreshness': 'Độ mới dữ liệu',
  'contextView.openAlerts': 'Cảnh báo đang mở',
  'contextView.critical': 'Nghiêm trọng: {count}',
  'contextView.warning': 'Cảnh báo: {count}',
  'contextView.info': 'Thông tin: {count}',
  'contextView.readinessReasons': 'Lý do về mức độ sẵn sàng',
  'contextView.moreInDashboard': 'và {count} mục khác trong dashboard',
  'contextView.healthSignals': 'Tín hiệu tình trạng',
  'contextView.wontGuess':
    'Tiện ích sẽ không đoán đây là tài khoản nào. Hãy mở tài khoản trong dashboard nếu bạn cần ' +
    'chắc chắn.',

  'sidepanel.title': 'Ngữ cảnh tài khoản',
  'sidepanel.notConnected.body': 'Kết nối tiện ích với dashboard của bạn để xem ngữ cảnh tài khoản.',
  'sidepanel.openAccountDetail': 'Mở chi tiết tài khoản',
  'sidepanel.openRelatedAlerts': 'Mở cảnh báo liên quan',
  'sidepanel.guard.title': 'Trước khi thay đổi cài đặt chiến dịch',
  'sidepanel.guard.reasonLabel': 'Vì sao bạn thực hiện thay đổi này?',
  'sidepanel.guard.reasonPlaceholder': 'Sẽ được ghi vào dòng thời gian tài khoản và nhật ký kiểm toán.',
  'sidepanel.guard.recording': 'Đang ghi nhận…',
  'sidepanel.guard.save': 'Lưu ý định thay đổi',
  'sidepanel.guard.hint':
    'Hãy tích đủ từng mục và ghi lý do trước. Danh sách này chỉ ghi lại những gì bạn đã kiểm tra; ' +
    'nó không chặn bất kỳ điều gì trong Ads Manager.',
  'sidepanel.guard.success': 'Đã ghi nhận ý định thay đổi vào dòng thời gian tài khoản.',
  'sidepanel.guard.failure': 'Không thể ghi nhận ý định thay đổi.',
  'sidepanel.quick.title': 'Ghi nhận một sự kiện',
  'sidepanel.quick.eventLabel': 'Sự kiện',
  'sidepanel.quick.noteLabel': 'Ghi chú',
  'sidepanel.quick.noteOptionalSuffix': ' (không bắt buộc)',
  'sidepanel.quick.recording': 'Đang ghi nhận…',
  'sidepanel.quick.record': 'Ghi nhận sự kiện',
  'sidepanel.quick.recorded': 'Đã ghi nhận: {label}.',
  'sidepanel.quick.failure': 'Không thể ghi nhận sự kiện này.',

  'options.title': 'AdsOps Control Center — cài đặt tiện ích',
  'options.version': 'Phiên bản {version}',
  'options.connection.title': 'Kết nối',
  'options.connection.status': 'Trạng thái',
  'options.connection.connectedBadge': 'Đã kết nối',
  'options.connection.workspace': 'Workspace',
  'options.connection.signedInAs': 'Đăng nhập với',
  'options.connection.dashboard': 'Dashboard',
  'options.connection.sessionExpires': 'Phiên hết hạn',
  'options.connection.unknown': 'không rõ',
  'options.connection.disconnect': 'Ngắt kết nối và thu hồi trình duyệt này',
  'options.connection.dashboardUrlLabel': 'URL Dashboard',
  'options.connection.dashboardUrlPlaceholder': 'https://adsops.example.com',
  'options.connection.urlHint':
    'Dùng địa chỉ HTTPS. HTTP thường chỉ được chấp nhận cho localhost khi phát triển.',
  'options.connection.emailLabel': 'Email',
  'options.connection.passwordLabel': 'Mật khẩu',
  'options.connection.labelLabel': 'Nhãn cho trình duyệt này (không bắt buộc)',
  'options.connection.labelPlaceholder': 'Chrome — hồ sơ BM USA',
  'options.connection.connecting': 'Đang kết nối…',
  'options.connection.connect': 'Kết nối',
  'options.connection.connected': 'Đã kết nối.',
  'options.connection.connectFailed': 'Không thể kết nối.',
  'options.connection.disconnected': 'Đã ngắt kết nối. Phiên đã bị thu hồi trên máy chủ.',
  'options.privacy.title': 'Tiện ích này làm gì với dữ liệu của bạn',
  'options.privacy.item1':
    'Nó đọc mã tài khoản trong URL của Ads Manager, đường dẫn trang, và tiêu đề trang. Không gì khác.',
  'options.privacy.item2':
    'Nó không bao giờ đọc cookie, local storage, session storage, lưu lượng mạng hay nội dung ' +
    'trang, và không bao giờ ghi vào trang Ads Manager.',
  'options.privacy.item3':
    'Mật khẩu của bạn chỉ dùng một lần để kết nối và không bao giờ được lưu lại. Sau đó tiện ' +
    'ích giữ một phiên riêng, ngắn hạn hơn, không thể đổi tài khoản, mức sẵn sàng hay cảnh báo.',
  'options.privacy.item4':
    'Phiên được giữ trong bộ nhớ tạm của tiện ích trên trình duyệt và bị xoá khi trình duyệt đóng.',
  'options.privacy.item5':
    'Ngắt kết nối sẽ thu hồi phiên trên máy chủ ngay lập tức, thay vì đợi đến khi hết hạn.',

  'languageToggle.vi': 'VI',
  'languageToggle.en': 'EN',
} as const
