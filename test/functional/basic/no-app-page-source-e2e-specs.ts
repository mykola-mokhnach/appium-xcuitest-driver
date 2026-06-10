import axios from 'axios';
import type {Browser} from 'webdriverio';
import {fs} from 'appium/support';
import {initSession, deleteSession, MOCHA_TIMEOUT} from '../helpers/session';
import {TESTAPP_BUNDLE_ID} from '../../setup';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

/**
 * Perf benchmark: legacy (no tunnel) vs remotexpc zip_conduit vs remotexpc AFC.
 * After driver/tuntap/remotexpc changes: `npm run link:local-ios`, restart Appium,
 * restart tunnel (`sudo appium driver run xcuitest tunnel-creation` — packet tap off by default since step 1).
 * If installs fail with ETIMEDOUT, check tunnel-creation logs for
 * `Tunnel upstream socket error` (CDTunnel died under load; fix tracked separately).
 */
const REAL_DEVICE_UDID =
  process.env.APPIUM_TEST_REAL_DEVICE_UDID ?? '00008030-000A49391460202E';
const IPA_PATH =
  process.env.APPIUM_TEST_IPA_PATH ??
  '/Users/elf/code/VodQAReactNative/ios/build/ipa/VodQAReactNative.ipa';
const PLATFORM_VERSION = process.env.APPIUM_TEST_PLATFORM_VERSION ?? '26.3';
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
/** Default from `scripts/tunnel-creation.mjs`; override with APPIUM_TEST_TUNNEL_REGISTRY_PORTS (comma-separated). */
const TUNNEL_REGISTRY_PORTS = (
  process.env.APPIUM_TEST_TUNNEL_REGISTRY_PORTS?.split(',').map((p) => Number.parseInt(p.trim(), 10)) ?? [
    42314, 60105, 60106, 60107, 60108, 60109, 60110,
  ]
).filter((p) => Number.isInteger(p) && p > 0);

interface InstallBenchmark {
  transport: string;
  sessionStartMs: number;
  uninstallMs: number;
  installMs: number;
  totalMs: number;
}

const benchmarks: InstallBenchmark[] = [];

function getRealDeviceCaps(capOverrides: Record<string, unknown> = {}) {
  return {
    'appium:udid': REAL_DEVICE_UDID,
    'appium:platformVersion': PLATFORM_VERSION,
    'appium:automationName': 'XCUITest',
    'appium:noReset': true,
    'appium:showXcodeLog': true,
    'appium:appPushTimeout': INSTALL_TIMEOUT_MS,
    platformName: 'iOS',
    ...capOverrides,
  };
}

async function timeAsync<T>(fn: () => Promise<T>): Promise<{result: T; durationMs: number}> {
  const start = performance.now();
  const result = await fn();
  return {result, durationMs: performance.now() - start};
}

async function isTunnelRegistryAvailable(): Promise<boolean> {
  const results = await Promise.all(
    TUNNEL_REGISTRY_PORTS.map(async (port) => {
      try {
        const res = await axios.get(`http://127.0.0.1:${port}/remotexpc/tunnels`, {
          timeout: 1000,
          validateStatus: (status) => status === 200,
        });
        return res.data?.status === 'OK';
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

async function ensureAppRemoved(driver: Browser): Promise<number> {
  const installed = await driver.execute('mobile: isAppInstalled', {bundleId: TESTAPP_BUNDLE_ID});
  if (!installed) {
    return 0;
  }
  const {durationMs} = await timeAsync(() =>
    driver.execute('mobile: removeApp', {bundleId: TESTAPP_BUNDLE_ID}),
  );
  return durationMs;
}

async function runInstallBenchmark(
  transport: string,
  capOverrides: Record<string, unknown> = {},
): Promise<InstallBenchmark> {
  const totalStart = performance.now();

  const {durationMs: sessionStartMs, result: driver} = await timeAsync(async () =>
    initSession(getRealDeviceCaps(capOverrides)),
  );

  try {
    const uninstallMs = await ensureAppRemoved(driver);
    const {durationMs: installMs} = await timeAsync(() =>
      driver.execute('mobile: installApp', {app: IPA_PATH, timeoutMs: INSTALL_TIMEOUT_MS}),
    );

    return {
      transport,
      sessionStartMs,
      uninstallMs,
      installMs,
      totalMs: performance.now() - totalStart,
    };
  } finally {
    await deleteSession();
  }
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function printBenchmark(benchmark: InstallBenchmark): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      `[${benchmark.transport}]`,
      `session=${formatMs(benchmark.sessionStartMs)}`,
      `uninstall=${formatMs(benchmark.uninstallMs)}`,
      `install=${formatMs(benchmark.installMs)}`,
      `total=${formatMs(benchmark.totalMs)}`,
    ].join(' '),
  );
}

function formatDelta(a: number, b: number): string {
  const diff = b - a;
  const pct = a > 0 ? ((diff / a) * 100).toFixed(1) : 'n/a';
  return `${diff >= 0 ? '+' : ''}${formatMs(diff)} (${pct}%)`;
}

function printComparison(): void {
  if (benchmarks.length < 2) {
    return;
  }
  const baseline = benchmarks[0];

  // eslint-disable-next-line no-console
  console.log('\n--- install benchmark comparison (install time vs first run) ---');
  for (const benchmark of benchmarks) {
    const installDelta =
      benchmark === baseline ? '' : ` (${formatDelta(baseline.installMs, benchmark.installMs)})`;
    const totalDelta =
      benchmark === baseline ? '' : ` (${formatDelta(baseline.totalMs, benchmark.totalMs)})`;
    // eslint-disable-next-line no-console
    console.log(
      `${benchmark.transport}: install=${formatMs(benchmark.installMs)}${installDelta}, ` +
        `total=${formatMs(benchmark.totalMs)}${totalDelta}`,
    );
  }
}

describe('XCUITestDriver - real device transport install performance -', function () {
  this.timeout(MOCHA_TIMEOUT * 5);

  before(async function () {
    if (process.env.CI) {
      this.skip();
    }
    if (!(await fs.exists(IPA_PATH))) {
      throw new Error(`IPA not found at '${IPA_PATH}'. Set APPIUM_TEST_IPA_PATH if needed.`);
    }
  });

  after(function () {
    printComparison();
  });

  describe('appium-ios-device (no tunnel)', function () {
    before(async function () {
      if (await isTunnelRegistryAvailable()) {
        this.skip();
      }
    });

    it('should install the IPA via legacy transport and record timings', async function () {
      const benchmark = await runInstallBenchmark('appium-ios-device');
      benchmarks.push(benchmark);
      printBenchmark(benchmark);
    });
  });

  describe('appium-ios-remotexpc zip_conduit (tunnel running)', function () {
    before(async function () {
      if (!(await isTunnelRegistryAvailable())) {
        this.skip();
      }
    });

    it('should install the IPA via remotexpc zip_conduit and record timings', async function () {
      const benchmark = await runInstallBenchmark('appium-ios-remotexpc/zip_conduit');
      benchmarks.push(benchmark);
      printBenchmark(benchmark);
    });
  });

  describe('appium-ios-remotexpc AFC (tunnel running)', function () {
    before(async function () {
      if (!(await isTunnelRegistryAvailable())) {
        this.skip();
      }
    });

    it('should install the IPA via remotexpc AFC and record timings', async function () {
      const benchmark = await runInstallBenchmark('appium-ios-remotexpc/afc', {
        'appium:useZipConduitInstall': false,
      });
      benchmarks.push(benchmark);
      printBenchmark(benchmark);
    });
  });
});
