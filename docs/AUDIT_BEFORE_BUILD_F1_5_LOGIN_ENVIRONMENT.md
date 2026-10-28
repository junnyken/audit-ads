# Audit Before Build — Slice F1.5: Login Environment & Client-Provided Account Directory

## 1. Problem Statement
Agencies managing many client accounts (`client_provided` and `agency_owned`) need a single source of truth to replace fragile spreadsheets specifying:
1. Whether a Facebook login profile (`PersonalAccountReference`) is internal to the agency (`agency_owned`) or handed over by a client (`client_provided`) and for which `client_name`.
2. Which fixed physical/virtual machine (`device_label`), browser/anti-detect profile (`browser_profile_label`), and network/IP label (`network_label`) the operator must use when logging in to resolve an incident, preventing cross-device/cross-profile login mistakes.

## 2. Security & Architectural Invariants (`CLAUDE.md`)
- **Rule 1 (Zero Credentials / Zero Proxy Secrets)**:
  - `client_name`, `device_label`, `browser_profile_label`, and `network_label` are validated by `_refuse_login_secret`.
  - `network_label` additionally rejects proxy credential strings (`user:pass@host`, `socks5://`, `http://`, or `ip:port:user:pass` with >=3 colons).
  - No browser automation, cookies, session tokens, passwords, or 2FA seeds are ever stored or accepted.
- **Rule 5 & Rule 6**:
  - Neutral/informative badges only; no banned safety or anti-ban claims anywhere in backend or frontend copy.
