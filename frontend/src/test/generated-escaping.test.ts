import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExtensionFilesForVia } from '../../scripts/extensionBuilderOffline'
import { downloadBatchPageCreationBat } from '../lib/chromeProfileLauncher'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('generated script escaping', () => {
  it('keeps Windows path separators in the downloaded batch launcher', async () => {
    let downloaded: Blob | undefined
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL(blob: Blob) {
        downloaded = blob
        return 'blob:test'
      }
      static revokeObjectURL() {}
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadBatchPageCreationBat([{
      page_name: 'Example', via_label: 'Example', browser_profile: 'Default',
      launch_url: 'https://example.com',
    }])
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsText(downloaded!)
    })
    for (const root of ['%ProgramFiles%', '%ProgramFiles(x86)%', '%LocalAppData%']) {
      const path = `${root}\\Google\\Chrome\\Application\\chrome.exe`
      expect(content).toContain(`if exist "${path}" set "CHROME_EXE=${path}"`)
    }
  })

  it('preserves whitespace splitting and numeric count validation in generated JavaScript', () => {
    const source = buildExtensionFilesForVia().map((file) => file.content).join('\n')
    const splitPattern = source.match(/cleanTitle\.split\((\/[^\n]+?\/)\)/)?.[1]
    const countPattern = source.match(/\.filter\(\(t\) => (\/[^\n]+?\/)\.test\(t\)\)/)?.[1]
    expect(splitPattern).toBeDefined()
    expect(countPattern).toBeDefined()
    // Execute only generated regex literals, without running the extension.
    const words = new Function(`return ${splitPattern}`)() as RegExp
    const count = new Function(`return ${countPattern}`)() as RegExp
    expect('Brand Studio\tTeam'.split(words)).toEqual(['Brand', 'Studio', 'Team'])
    expect(count.test('1234')).toBe(true)
    expect(count.test('12345')).toBe(false)
    expect(count.test('dddd')).toBe(false)
  })
})
