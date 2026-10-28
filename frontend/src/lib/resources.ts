import type { ResourceSpec } from '../components/ReferenceManager'
import { withCommonFields } from '../components/ReferenceManager'

/**
 * The registry resources managed by `ReferenceManager`. Every user-facing string is an i18n key
 * (resolved at render time), so the same specs serve both languages. The API paths, `key`s (which
 * double as TanStack query keys) and field names are unchanged.
 */
export const BUSINESS_MANAGERS: ResourceSpec = {
  key: 'business-managers',
  path: '/api/v1/business-managers',
  singular: 'res.bm.singular',
  plural: 'res.bm.plural',
  description: 'res.bm.description',
  fields: withCommonFields([
    { name: 'name', label: 'res.f.name', required: true, maxLength: 200 },
    { name: 'external_id', label: 'res.f.externalId', maxLength: 120, hint: 'res.f.externalId.hint' },
    { name: 'country', label: 'res.f.country', maxLength: 2, uppercase: true },
    { name: 'currency', label: 'res.f.currency', maxLength: 3, uppercase: true },
  ]),
}

export const PERSONAL_REFERENCES: ResourceSpec = {
  key: 'personal-account-references',
  path: '/api/v1/personal-account-references',
  singular: 'res.personal.singular',
  plural: 'res.personal.plural',
  description: 'res.personal.description',
  note: 'res.personal.note',
  fields: withCommonFields([
    { name: 'label', label: 'res.f.label', required: true, maxLength: 200 },
    { name: 'display_name', label: 'res.f.displayName', maxLength: 200 },
    { name: 'external_reference_id', label: 'res.f.externalReferenceId', maxLength: 120 },
    {
      name: 'two_factor_method',
      label: 'fb.twoFactor',
      type: 'select',
      options: [
        ['unknown', 'twoFactor.unknown'],
        ['app', 'twoFactor.app'],
        ['sms', 'twoFactor.sms'],
        ['security_key', 'twoFactor.security_key'],
        ['none', 'twoFactor.none'],
      ],
    },
    { name: 'vault_reference', label: 'fb.form.vaultLabel', maxLength: 2048, hideInTable: true },
    { name: 'recovery_note', label: 'fb.detail.recovery', type: 'textarea', maxLength: 2000, hideInTable: true },
    { name: 'country', label: 'res.f.country', maxLength: 2, uppercase: true, hideInTable: true },
    { name: 'timezone', label: 'res.f.timezone', maxLength: 64, hideInTable: true },
  ]),
}

export const PAGES: ResourceSpec = {
  key: 'pages',
  path: '/api/v1/pages',
  singular: 'res.page.singular',
  plural: 'res.page.plural',
  description: 'res.page.description',
  fields: withCommonFields([
    { name: 'name', label: 'res.f.name', required: true, maxLength: 200 },
    { name: 'external_page_id', label: 'res.f.externalPageId', maxLength: 120 },
    { name: 'url', label: 'res.f.url', type: 'url', maxLength: 2048 },
    { name: 'category', label: 'res.f.category', maxLength: 120 },
  ]),
}

export const PIXELS: ResourceSpec = {
  key: 'pixels',
  path: '/api/v1/pixels',
  singular: 'res.pixel.singular',
  plural: 'res.pixel.plural',
  description: 'res.pixel.description',
  fields: withCommonFields([
    { name: 'name', label: 'res.f.name', required: true, maxLength: 200 },
    { name: 'external_pixel_id', label: 'res.f.externalPixelId', maxLength: 120 },
  ]),
}

export const PAYMENT_REFERENCES: ResourceSpec = {
  key: 'payment-profile-references',
  path: '/api/v1/payment-profile-references',
  singular: 'res.payment.singular',
  plural: 'res.payment.plural',
  description: 'res.payment.description',
  note: 'res.payment.note',
  fields: withCommonFields([
    { name: 'reference_code', label: 'res.f.referenceCode', required: true, maxLength: 120 },
    { name: 'label', label: 'res.f.label', maxLength: 200 },
    { name: 'provider', label: 'res.f.provider', maxLength: 120 },
    { name: 'billing_country', label: 'res.f.billingCountry', maxLength: 2, uppercase: true },
    { name: 'currency', label: 'res.f.currency', maxLength: 3, uppercase: true },
  ]),
}

export const BROWSER_REFERENCES: ResourceSpec = {
  key: 'browser-profile-references',
  path: '/api/v1/browser-profile-references',
  singular: 'res.browser.singular',
  plural: 'res.browser.plural',
  description: 'res.browser.description',
  note: 'res.browser.note',
  fields: withCommonFields([
    { name: 'profile_reference', label: 'res.f.profileReference', required: true, maxLength: 200 },
    { name: 'provider', label: 'res.f.provider', maxLength: 120 },
    { name: 'label', label: 'res.f.label', maxLength: 200 },
    {
      name: 'local_or_remote',
      label: 'res.f.location',
      type: 'select',
      options: [
        ['local', 'res.opt.local'],
        ['remote', 'res.opt.remote'],
      ],
    },
  ]),
}

export const PROXY_REFERENCES: ResourceSpec = {
  key: 'proxy-references',
  path: '/api/v1/proxy-references',
  singular: 'res.proxy.singular',
  plural: 'res.proxy.plural',
  description: 'res.proxy.description',
  note: 'res.proxy.note',
  fields: withCommonFields([
    { name: 'proxy_reference', label: 'res.f.proxyReference', required: true, maxLength: 200 },
    { name: 'provider', label: 'res.f.provider', maxLength: 120 },
    { name: 'label', label: 'res.f.label', maxLength: 200 },
    { name: 'country', label: 'res.f.country', maxLength: 2, uppercase: true },
    { name: 'region', label: 'res.f.region', maxLength: 120 },
    {
      name: 'protocol',
      label: 'res.f.protocol',
      type: 'select',
      options: [
        ['', 'res.opt.unspecified'],
        ['http', 'res.opt.http'],
        ['https', 'res.opt.https'],
        ['socks5', 'res.opt.socks5'],
      ],
    },
  ]),
}
