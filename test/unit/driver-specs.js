import xcode from 'appium-xcode';
import {JWProxy} from 'appium/driver';
import _ from 'lodash';
import {createSandbox} from 'sinon';
import cmds from '../../lib/commands';
import {XCUITestDriver} from '../../lib/driver';
import * as utils from '../../lib/utils';
import {MOCHA_LONG_TIMEOUT} from './helpers';
import {RealDevice} from '../../lib/real-device';
import net from 'node:net';

const caps = {
  fistMatch: [{}],
  alwaysMatch: {
    platformName: 'iOS',
    'appium:deviceName': 'iPhone 6',
    'appium:app': '/foo.app',
    'appium:platformVersion': '10.0',
  },
};

describe('XCUITestDriver', function () {
  let sandbox;
  let chai;
  let expect;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

    expect = chai.expect;
  });

  beforeEach(function () {
    sandbox = createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('getDefaultUrl', function () {
    let driver;
    let realDevice;

    beforeEach(function () {
      driver = new XCUITestDriver();
      realDevice = new RealDevice('1234');
    });

    it('real device', function () {
      driver._device = realDevice;
      expect(driver.getDefaultUrl()).eq('http://127.0.0.1:8100/health');
    });

    it('simulator with ipv4', function () {
      driver.opts.wdaLocalPort = 8111;
      expect(driver.getDefaultUrl()).eq('http://127.0.0.1:8111/health');
    });

    it('simulator with ipv6', function () {
      driver.opts.address = '::1';
      expect(driver.getDefaultUrl()).eq('http://127.0.0.1:8100/health');
    });
  });

  describe('driver commands', function () {
    describe('status', function () {
      /** @type {XCUITestDriver} */
      let driver;
      /** @type {import('sinon').SinonStubbedMember<typeof JWProxy.prototype.command>} */
      let jwproxyCommandSpy;

      beforeEach(function () {
        driver = new XCUITestDriver();

        // fake the proxy to WDA
        const jwproxy = new JWProxy();
        jwproxyCommandSpy = sandbox.stub(jwproxy, 'command').resolves({some: 'thing'});
        driver.wda = {
          jwproxy,
        };
      });

      it('should not have wda status by default', async function () {
        const status = await driver.getStatus();
        jwproxyCommandSpy.calledOnce.should.be.false;
        expect(status.wda).to.be.undefined;
      });

      it('should return wda status if cached', async function () {
        driver.cachedWdaStatus = {};
        const status = await driver.getStatus();
        jwproxyCommandSpy.called.should.be.false;
        status.wda.should.exist;
      });
    });

    describe('createSession', function () {
      let driver;
      let device;
      let realDevice;

      afterEach(async function () {
        await driver.deleteSession();
      });
      beforeEach(function () {
        driver = new XCUITestDriver();
        device = {
          shutdown: _.noop,
          isRunning() {
            return true;
          },
          stat() {
            return {state: 'Booted'};
          },
          getWebInspectorSocket() {
            return '/path/to/uds.socket';
          },
          setReduceTransparency: _.noop,
          setAutoFillPasswords: _.noop,
          reset: _.noop,
        };
        const cacheMock = sandbox.mock(driver.appInfosCache);
        cacheMock.expects('extractBundleId').once().returns('bundle.id');
        realDevice = null;
        sandbox
          .stub(driver, 'determineDevice')
          .callsFake(async () => ({device, realDevice, udid: 'stuff'}));
        sandbox.stub(driver, 'configureApp');
        sandbox.stub(driver, 'startLogCapture');
        sandbox.stub(driver, 'startSim');
        sandbox.stub(driver, 'startWdaSession');
        sandbox.stub(driver, 'startWda');
        sandbox.stub(driver, 'installAUT');
        sandbox.stub(driver, 'connectToRemoteDebugger');
        sandbox.stub(xcode, 'getMaxIOSSDK').resolves('10.0');
        sandbox.stub(utils, 'checkAppPresent');
        sandbox.stub(utils, 'getAndCheckXcodeVersion').resolves({
          versionString: '20.0',
          versionFloat: 20.0,
          major: 20,
          minor: 0,
          toString() {
            return '20.0';
          },
        });
      });

      it('should include server capabilities', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        const resCaps = await driver.createSession(null, null, _.cloneDeep(caps));
        resCaps[1].javascriptEnabled.should.be.true;
      });

      it('should call startLogCapture', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        const resCaps = await driver.createSession(
          null,
          null,
          _.merge({}, caps, {
            alwaysMatch: {
              'appium:skipLogCapture': false,
            },
          }),
        );
        resCaps[1].javascriptEnabled.should.be.true;
        driver.startLogCapture.called.should.be.true;
      });
      it('should not call startLogCapture', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        const resCaps = await driver.createSession(
          null,
          null,
          _.merge({}, caps, {
            alwaysMatch: {
              'appium:skipLogCapture': true,
            },
          }),
        );
        resCaps[1].javascriptEnabled.should.be.true;
        driver.startLogCapture.called.should.be.false;
      });
      it('should call setReduceTransparency for a simulator', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        device.simctl = true;
        delete device.devicectl;
        const spy = sandbox.stub(device, 'setReduceTransparency').resolves({device, realDevice});
        await driver.createSession(
          null,
          null,
          _.merge({}, caps, {
            alwaysMatch: {'appium:reduceTransparency': true},
          }),
        );
        spy.calledOnce.should.be.true;
        spy.firstCall.args[0].should.eql(true);
      });

      it('should not call setReduceTransparency for a real device', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        delete device.simctl;
        device.devicectl = true;
        const spy = sandbox.stub(device, 'setReduceTransparency').resolves({device, realDevice});
        await driver.createSession(
          null,
          null,
          _.merge({}, caps, {
            alwaysMatch: {'appium:reduceTransparency': true},
          }),
        );
        spy.notCalled.should.be.true;
      });

      it('should call setAutoFillPasswords for a simulator', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        device.simctl = true;
        delete device.devicectl;
        const spy = sandbox.stub(device, 'setAutoFillPasswords').resolves({device, realDevice});
        await driver.createSession(
          null,
          null,
          _.merge({}, caps, {
            alwaysMatch: {'appium:autoFillPasswords': true},
          }),
        );
        spy.calledOnce.should.be.true;
        spy.firstCall.args[0].should.eql(true);
      });
      it('should not call setAutoFillPasswords for a real device', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        delete device.simctl;
        device.devicectl = true;
        const spy = sandbox.stub(device, 'setAutoFillPasswords').resolves({device, realDevice});
        await driver.createSession(
          null,
          null,
          _.merge({}, caps, {
            alwaysMatch: {'appium:setAutoFillPasswords': true},
          }),
        );
        spy.notCalled.should.be.true;
      });

      it('should throw an error if mjpegServerPort is occupied', async function () {
        this.timeout(MOCHA_LONG_TIMEOUT);
        delete device.simctl;
        device.devicectl = true;
        const server = net.createServer();
        await new Promise((resolve, reject) => {
          server.listen(9100, resolve);
          server.on('error', reject);
        });
        try {
          await driver.createSession(
            null,
            null,
            _.merge({}, caps, {
              alwaysMatch: {'appium:mjpegServerPort': 9100},
            }),
          ).should.be.rejectedWith(/mjpegServerPort.*port #9100 is occupied/);
        } finally {
          await new Promise((resolve, reject) => {
            server.close(resolve);
            server.on('error', reject);
        });
       }
      });
    });

    describe('execute', function () {
      /** @type {XCUITestDriver} */
      let driver;
      const deviceInfoResponse = {some: 'thing'};

      beforeEach(function () {
        driver = new XCUITestDriver();
        const jwproxy = new JWProxy();
        sandbox.stub(jwproxy, 'command').resolves(deviceInfoResponse);
        driver.wda = {
          jwproxy,
        };
      });

      it('should allow execute methods without whitespace', async function () {
        await expect(driver.execute('mobile:deviceInfo')).to.eventually.eql(deviceInfoResponse);
      });

      it('should allow execute methods with hella whitespace', async function () {
        await expect(driver.execute('mobile:           deviceInfo')).to.eventually.eql(
          deviceInfoResponse,
        );
      });

      it('should allow execute methods with leading/trailing whitespace', async function () {
        await expect(driver.execute(' mobile: deviceInfo ')).to.eventually.eql(deviceInfoResponse);
      });
    });
  });

  describe('installOtherApps', function () {
    /** @type {XCUITestDriver} */
    let driver;

    beforeEach(function () {
      driver = new XCUITestDriver();
    });

    it('should install multiple apps from otherApps as string on on real devices', async function () {
      const RealDeviceManagementModule = require('../../lib/real-device-management');
      sandbox.stub(RealDeviceManagementModule, 'installToRealDevice');
      sandbox.stub(driver, 'isRealDevice').returns(true);
      sandbox.stub(driver.helpers, 'configureApp').resolves('/path/to/iosApp.app');
      sandbox.mock(driver.appInfosCache)
        .expects('extractBundleId').resolves('bundle-id');
      // @ts-expect-error random stuff on opts
      driver.opts.device = 'some-device';
      driver.lifecycleData = {createSim: false};
      await driver.installOtherApps('/path/to/iosApp.app');
      (driver.isRealDevice).calledOnce.should.be.true;
      (driver.helpers.configureApp).calledOnce.should.be.true;
      (RealDeviceManagementModule.installToRealDevice).calledOnceWith(
        '/path/to/iosApp.app',
        'bundle-id',
        {skipUninstall: true, timeout: undefined},
      ).should.be.true;
    });

    it('should install multiple apps from otherApps as JSON array on on real devices', async function () {
      const RealDeviceManagementModule = require('../../lib/real-device-management');
      sandbox.stub(RealDeviceManagementModule, 'installToRealDevice');
      sandbox.stub(driver, 'isRealDevice').returns(true);
      const configureAppStub = sandbox.stub(driver.helpers, 'configureApp');
      configureAppStub.onCall(0).resolves('/path/to/iosApp1.app');
      configureAppStub.onCall(1).resolves('/path/to/iosApp2.app');
      sandbox.stub(driver.appInfosCache, 'extractBundleId')
        .onCall(0).resolves('bundle-id')
        .onCall(1).resolves('bundle-id2');
      // @ts-expect-error random stuff on opts
      driver.opts.device = 'some-device';
      driver.lifecycleData = {createSim: false};
      await driver.installOtherApps('["/path/to/iosApp1.app","/path/to/iosApp2.app"]');
      (driver.isRealDevice).calledTwice.should.be.true;
      (driver.helpers.configureApp).calledTwice.should.be.true;
      (RealDeviceManagementModule.installToRealDevice).calledWith(
        '/path/to/iosApp1.app',
        'bundle-id',
        {skipUninstall: true, timeout: undefined},
      ).should.be.true;
      (RealDeviceManagementModule.installToRealDevice).calledWith(
        '/path/to/iosApp2.app',
        'bundle-id2',
        {skipUninstall: true, timeout: undefined},
      ).should.be.true;
    });

    it('should install multiple apps from otherApps as string on simulators', async function () {
      const SimulatorManagementModule = require('../../lib/simulator-management');
      sandbox.stub(SimulatorManagementModule, 'installToSimulator');
      sandbox.stub(driver, 'isRealDevice').returns(false);
      sandbox.stub(driver.helpers, 'configureApp').resolves('/path/to/iosApp.app');
      sandbox.mock(driver.appInfosCache)
        .expects('extractBundleId').resolves('bundle-id');
      driver.opts.noReset = false;
      // @ts-expect-error random stuff on opts
      driver.opts.device = 'some-device';
      driver.lifecycleData = {createSim: false};
      await driver.installOtherApps('/path/to/iosApp.app');
      (driver.isRealDevice).calledOnce.should.be.true;
      (driver.helpers.configureApp).calledOnce.should.be.true;
      (SimulatorManagementModule.installToSimulator).calledOnceWith(
        '/path/to/iosApp.app',
        'bundle-id',
        {newSimulator: false},
      ).should.be.true;
    });

    it('should install multiple apps from otherApps as JSON array on simulators', async function () {
      const SimulatorManagementModule = require('../../lib/simulator-management');
      sandbox.stub(SimulatorManagementModule, 'installToSimulator');
      sandbox.stub(driver, 'isRealDevice').returns(false);
      const configureAppStub = sandbox.stub(driver.helpers, 'configureApp');
      configureAppStub.onCall(0).resolves('/path/to/iosApp1.app');
      configureAppStub.onCall(1).resolves('/path/to/iosApp2.app');
      sandbox.stub(driver.appInfosCache, 'extractBundleId')
        .onCall(0).resolves('bundle-id')
        .onCall(1).resolves('bundle-id2');
      driver.opts.noReset = false;
      driver.lifecycleData = {createSim: false};
      await driver.installOtherApps('["/path/to/iosApp1.app","/path/to/iosApp2.app"]');
      (driver.isRealDevice).calledTwice.should.be.true;
      (driver.helpers.configureApp).calledTwice.should.be.true;
      (SimulatorManagementModule.installToSimulator).calledWith(
        '/path/to/iosApp1.app',
        'bundle-id',
        {newSimulator: false},
      ).should.be.true;
      (SimulatorManagementModule.installToSimulator).calledWith(
        '/path/to/iosApp2.app',
        'bundle-id2',
        {newSimulator: false},
      ).should.be.true;
    });
  });

  describe('mixins', function () {
    /**
     * these methods will fail strict equality checks.
     * key is the prop of the default export from `lib/commands/index.js`,
     * value is a set of method names
     */
    const memoizedMethods = new Map([
      [
        'generalExtensions',
        new Set(['getStatusBarHeight', 'getDevicePixelRatio', 'getScreenInfo']),
      ],
    ]);

    /**
     * Lookup of prop name to method.  Initially, this contains all methods in `XCUITestDriver.prototype`
     * Used to check if:
     * - a mixin method overwrites a method in the driver prototype
     * - a mixin method overwrites a method from another mixin
     * @type {Map<string,string>}
     */
    const foundProps = new Map(
      Object.getOwnPropertyNames(XCUITestDriver.prototype).map((propName) => [
        propName,
        XCUITestDriver.prototype[propName],
      ]),
    );

    for (const [mixinName, mixin] of Object.entries(cmds)) {
      describe(mixinName, function () {
        /** @type {XCUITestDriver} */
        let driver;

        before(function () {
          driver = new XCUITestDriver();
        });

        for (const propName of Object.getOwnPropertyNames(mixin).filter(
          (propName) => !memoizedMethods.get(mixinName)?.has(propName),
        )) {
          it(`${propName} should be mixed in`, function () {
            try {
              expect(
                foundProps.has(propName),
                `"${propName}" overwrites a member from the driver prototype or another mixin`,
              ).to.be.false;
              expect(driver).to.have.property(propName, mixin[propName]);
            } finally {
              foundProps.set(propName, mixinName);
            }
          });
        }
      });
    }
  });
});
