import { describe, expect, it } from 'vitest';
import {
  buildExtensionFilesForVia,
  buildViaKeepAliveUrl,
  planHumanKeepAliveRoute,
  type WarmupMode,
} from '../lib/chromeProfileLauncher';
import {
  DEFAULT_MAX_VIAS_PER_PROXY,
  getMaxViasPerProxy,
  setMaxViasPerProxy,
} from '../lib/proxyClusterPrefs';

const WARMUP_MODES: WarmupMode[] = ['soak_72h', 'human_organic', 'bm_warmup', 'pre_camp'];

describe('AdsOps Companion v2.9.7 Zero-Trust, anti-checkpoint & stewardship builder', () => {
  it('builds manifest v2.9.7 with alarms permission, Zero-Trust X-AdsOps-Bridge-Token, and valid JS syntax for all scripts', () => {
    const files = buildExtensionFilesForVia(
      'AdsOps-Chrome-Extension',
      'Via Khách Hàng A',
      'Profile 9',
      'http://proxyuser:proxypass@103.10.20.30:8080',
      [],
      'JBSWY3DPEHPK3PXP',
      'camp',
      'via-cust-a-01',
      {
        clientGroup: 'KhachHangA',
        warmupPhase: 'soak',
        warmupStartIso: new Date().toISOString(),
        soakHoursRemaining: 48,
        defaultWarmupMode: 'soak_72h',
        soakQuarantineEnabled: true,
        ipKillSwitch: true,
        autoVaultCookieRefresh: true,
        trustScore: 85,
        bridgeToken: 'test-bridge-token-abcdef1234567890abcdef1234567890',
      },
    );

    const byName = new Map(files.map((f) => [f.name, f.content]));
    const manifestRaw = byName.get('AdsOps-Chrome-Extension/manifest.json');
    expect(manifestRaw).toBeTruthy();

    const manifest = JSON.parse(manifestRaw!);
    expect(manifest.version).toBe('2.9.8');
    expect(Array.isArray(manifest.permissions)).toBe(true);
    expect(manifest.permissions).toContain('alarms');

    for (const jsFile of ['passkey_shield.js', 'background.js', 'content.js', 'popup.js']) {
      const code = byName.get(`AdsOps-Chrome-Extension/${jsFile}`);
      expect(code, `missing ${jsFile}`).toBeTruthy();
      expect(() => new Function(code!)).not.toThrow();
    }

    const bgCode = byName.get('AdsOps-Chrome-Extension/background.js')!;
    const popupCode = byName.get('AdsOps-Chrome-Extension/popup.js')!;
    expect(bgCode).toContain('X-AdsOps-Bridge-Token');
    expect(bgCode).toContain('test-bridge-token-abcdef1234567890abcdef1234567890');
    expect(popupCode).toContain('getPopupBridgeHeaders');
    expect(popupCode).toContain('X-AdsOps-Bridge-Token');
  });

  it('includes both legacy Manage IDs and new Automation/Anti-Checkpoint/Bridge-Token IDs in popup.html', () => {
    const files = buildExtensionFilesForVia(
      'AdsOps-Chrome-Extension',
      'Via Test Popup',
      'Default',
      '',
      [],
      '',
      'standby',
      'via-popup-1',
    );
    const popupHtml = files.find((f) => f.name === 'AdsOps-Chrome-Extension/popup.html')?.content ?? '';
    expect(popupHtml).toBeTruthy();

    const requiredIds = [
      'tab-btn-manage',
      'tab-panel-manage',
      'btn-copy-otp',
      'btn-fill-otp',
      'btn-vault-save',
      'btn-push-token-cloud',
      'btn-save-enable',
      'btn-disable-proxy',
      'tab-btn-auto',
      'tab-panel-auto',
      'auto-trust-score',
      'ka-mode-select',
      'chk-ip-killswitch',
      'chk-soak-lock',
      'chk-auto-vault-cookie',
      'bridge-token-input',
      'btn-save-bridge-token',
    ];

    for (const id of requiredIds) {
      expect(popupHtml, `popup.html missing #${id}`).toContain(`id="${id}"`);
    }
  });

  it('generates distinct Keep-Alive plans and URLs for all 4 WarmupModes', () => {
    const urls = new Set<string>();

    for (const mode of WARMUP_MODES) {
      const plan = planHumanKeepAliveRoute('camp', mode);
      expect(plan).toBeTruthy();
      expect(plan.mode).toBe(mode);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.estimatedSeconds).toBeGreaterThan(0);

      const url = buildViaKeepAliveUrl({
        autoCloseTab: true,
        viaLabel: 'ViaKeepAliveTest',
        viaTier: 'camp',
        warmupMode: mode,
      });
      expect(url).toMatch(/^https:\/\/([a-z0-9-]+\.)?facebook\.com/i);
      expect(url).toContain(mode);
      urls.add(url);
    }

    expect(urls.size).toBe(WARMUP_MODES.length);
  });

  it('contains zero mock or placeholder strings in generated extension files', () => {
    const files = buildExtensionFilesForVia(
      'AdsOps-Chrome-Extension',
      'Via Real Check',
      'Default',
      '',
      [],
      '',
      'vault',
      'via-real-check',
    );
    const mockPattern = /\b(acme|john@doe|lorem ipsum|mock_data|fake_via)\b/i;
    for (const file of files) {
      expect(file.content, `mock token detected in ${file.name}`).not.toMatch(mockPattern);
    }
  });

  it('supports customizable max Vias per proxy preference with 1..50 clamping and default 4', () => {
    window.localStorage.removeItem('adsops_max_vias_per_proxy');
    expect(getMaxViasPerProxy()).toBe(DEFAULT_MAX_VIAS_PER_PROXY);
    expect(DEFAULT_MAX_VIAS_PER_PROXY).toBe(4);

    let fired = 0;
    const onChanged = () => {
      fired += 1;
    };
    window.addEventListener('adsops:proxy-prefs-changed', onChanged);
    try {
      expect(setMaxViasPerProxy(10)).toBe(10);
      expect(getMaxViasPerProxy()).toBe(10);
      expect(setMaxViasPerProxy(999)).toBe(50);
      expect(getMaxViasPerProxy()).toBe(50);
      expect(setMaxViasPerProxy(0)).toBe(1);
      expect(getMaxViasPerProxy()).toBe(1);
      expect(fired).toBe(3);
    } finally {
      window.removeEventListener('adsops:proxy-prefs-changed', onChanged);
      window.localStorage.removeItem('adsops_max_vias_per_proxy');
    }
  });
});
