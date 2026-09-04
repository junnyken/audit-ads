import type { ResourceSpec } from '../components/ReferenceManager'
import { withCommonFields } from '../components/ReferenceManager'

export const BUSINESS_MANAGERS: ResourceSpec = {
  key: 'business-managers',
  path: '/api/v1/business-managers',
  singular: 'Business Manager',
  plural: 'Business Managers',
  description: 'Business Manager records that ad accounts are mapped to.',
  fields: withCommonFields([
    { name: 'name', label: 'Name', required: true, maxLength: 200 },
    { name: 'external_id', label: 'External ID', maxLength: 120, hint: 'Unique within this workspace.' },
    { name: 'country', label: 'Country', maxLength: 2, uppercase: true },
    { name: 'currency', label: 'Currency', maxLength: 3, uppercase: true },
  ]),
}

export const PERSONAL_REFERENCES: ResourceSpec = {
  key: 'personal-account-references',
  path: '/api/v1/personal-account-references',
  singular: 'Personal account reference',
  plural: 'Personal account references',
  description: 'Ownership context for accounts that are not held under a Business Manager.',
  note: 'This is reference metadata only. It is never an authentication container — no login, password, cookie or session material is accepted here.',
  fields: withCommonFields([
    { name: 'label', label: 'Label', required: true, maxLength: 200 },
    { name: 'display_name', label: 'Display name', maxLength: 200 },
    { name: 'external_reference_id', label: 'External reference ID', maxLength: 120 },
    { name: 'country', label: 'Country', maxLength: 2, uppercase: true },
    { name: 'timezone', label: 'Timezone', maxLength: 64 },
  ]),
}

export const PAGES: ResourceSpec = {
  key: 'pages',
  path: '/api/v1/pages',
  singular: 'Page',
  plural: 'Pages',
  description: 'Pages that can be linked to ad accounts.',
  fields: withCommonFields([
    { name: 'name', label: 'Name', required: true, maxLength: 200 },
    { name: 'external_page_id', label: 'External page ID', maxLength: 120 },
    { name: 'url', label: 'URL', type: 'url', maxLength: 2048 },
    { name: 'category', label: 'Category', maxLength: 120 },
  ]),
}

export const PIXELS: ResourceSpec = {
  key: 'pixels',
  path: '/api/v1/pixels',
  singular: 'Pixel',
  plural: 'Pixels',
  description: 'Pixels that can be linked to ad accounts.',
  fields: withCommonFields([
    { name: 'name', label: 'Name', required: true, maxLength: 200 },
    { name: 'external_pixel_id', label: 'External pixel ID', maxLength: 120 },
  ]),
}

export const PAYMENT_REFERENCES: ResourceSpec = {
  key: 'payment-profile-references',
  path: '/api/v1/payment-profile-references',
  singular: 'Payment profile reference',
  plural: 'Payment profile references',
  description: 'Labels pointing at payment arrangements managed outside this product.',
  note: 'Reference labels only. Card numbers, billing credentials and payment logins are refused by the API — A1 excludes payment changes entirely.',
  fields: withCommonFields([
    { name: 'reference_code', label: 'Reference code', required: true, maxLength: 120 },
    { name: 'label', label: 'Label', maxLength: 200 },
    { name: 'provider', label: 'Provider', maxLength: 120 },
    { name: 'billing_country', label: 'Billing country', maxLength: 2, uppercase: true },
    { name: 'currency', label: 'Currency', maxLength: 3, uppercase: true },
  ]),
}

export const BROWSER_REFERENCES: ResourceSpec = {
  key: 'browser-profile-references',
  path: '/api/v1/browser-profile-references',
  singular: 'Browser profile reference',
  plural: 'Browser profile references',
  description: 'Labels for the browser environments you use to work on accounts.',
  note: 'A profile reference is a local label, not a cookie path, a profile export or a credential location. The product launches nothing and stores no session material.',
  fields: withCommonFields([
    { name: 'profile_reference', label: 'Profile reference', required: true, maxLength: 200 },
    { name: 'provider', label: 'Provider', maxLength: 120 },
    { name: 'label', label: 'Label', maxLength: 200 },
    {
      name: 'local_or_remote',
      label: 'Location',
      type: 'select',
      options: [
        ['local', 'Local'],
        ['remote', 'Remote'],
      ],
    },
  ]),
}

export const PROXY_REFERENCES: ResourceSpec = {
  key: 'proxy-references',
  path: '/api/v1/proxy-references',
  singular: 'Proxy reference',
  plural: 'Proxy references',
  description: 'Opaque labels for proxy arrangements, held as operational metadata.',
  note: 'Enter an operator label such as "smartproxy-vn-01". Hostnames, usernames, passwords and full connection strings are rejected — this product has no secret vault and performs no proxy rotation.',
  fields: withCommonFields([
    { name: 'proxy_reference', label: 'Proxy reference', required: true, maxLength: 200 },
    { name: 'provider', label: 'Provider', maxLength: 120 },
    { name: 'label', label: 'Label', maxLength: 200 },
    { name: 'country', label: 'Country', maxLength: 2, uppercase: true },
    { name: 'region', label: 'Region', maxLength: 120 },
    {
      name: 'protocol',
      label: 'Protocol',
      type: 'select',
      options: [
        ['', 'Unspecified'],
        ['http', 'HTTP'],
        ['https', 'HTTPS'],
        ['socks5', 'SOCKS5'],
      ],
    },
  ]),
}
