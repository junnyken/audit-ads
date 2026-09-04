# Why this extension asks for what it asks for

Every entry below exists because something in the extension stops working without it. Nothing
here is "just in case".

## Permissions

| Permission | Why | What it is not used for |
|---|---|---|
| `storage` | Keep the dashboard URL, the extension session and a per-tab context cache | Never used to read anything a website stored |
| `sidePanel` | Open the account panel beside Ads Manager | — |
| `activeTab` | Read the URL of the tab you are actively looking at, when you open the popup | Not a standing permission over every tab |

## Host permissions

```
https://adsmanager.facebook.com/*
https://business.facebook.com/*
https://www.facebook.com/adsmanager/*
```

Narrower than they first appear: the third is scoped to the `/adsmanager` path, so the content
script never loads on the Facebook feed, on Messenger, on a profile or on any other page. There
is **no** `<all_urls>` and no bare `https://www.facebook.com/*`.

## What is deliberately absent

| Not requested | Why it would be needed, and why we do not |
|---|---|
| `cookies` | Reading a Meta session cookie. Never — this product does not touch session material |
| `webRequest` / `declarativeNetRequest` | Intercepting requests or reading `Authorization` headers. Never |
| `scripting` | Injecting code into a page at will. The content script is declared statically and read-only |
| `tabs` | Reading every tab's URL in the background. `activeTab` covers what the popup needs |
| `proxy` | Configuring or rotating proxies. Never |
| `debugger` | Driving the page. Never |
| `<all_urls>` | Running everywhere. Never |

## The dashboard API origin

The API host is **not** in `host_permissions`, even though the extension calls it. A host
permission would let the extension bypass CORS for that origin; instead the request follows
ordinary CORS rules and the API's exact-origin allowlist decides.

That means a deployment must add the extension's origin to `CORS_ORIGINS`:

```
CORS_ORIGINS=https://adsops.example.com,chrome-extension://<EXTENSION_ID>
```

The id is only known once the extension is packed. This is an exact origin, not a wildcard, so
it does not weaken the production configuration check added in A4.

## What the extension reads from a page

The account id shown in the page URL (`act=…`), the route path, and the account name if the
page displays one — the name for display only, never for matching.

It does not read cookies, `localStorage`, `sessionStorage`, IndexedDB, network traffic,
keystrokes, form values or page content beyond the above. It writes nothing to the host page:
its UI lives in the popup and the side panel, which are extension pages.
