/// <reference types="vite/client" />

interface ChromeWebViewHost {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (ev: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (ev: { data: unknown }) => void) => void
}

interface Window {
  chrome?: {
    webview?: ChromeWebViewHost
  }
}
