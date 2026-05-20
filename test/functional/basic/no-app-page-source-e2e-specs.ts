import {initSession, deleteSession, MOCHA_TIMEOUT} from '../helpers/session';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);

const REAL_DEVICE_UDID = '00008030-000A49391460202E';
// const WDA_BUNDLE_ID = 'com.appium.WebDriverAgentRunner1234';

function getRealDeviceCaps() {
  return {
    'appium:udid': REAL_DEVICE_UDID,
    'appium:platformVersion': '26.3',
    'appium:automationName': 'XCUITest',
    'appium:noReset': true,
    'appium:showXcodeLog': true,
    platformName: 'iOS',
  };
}

describe('XCUITestDriver - real device no app page source -', function () {
  this.timeout(MOCHA_TIMEOUT);

  let driver;

  before(async function () {
    driver = await initSession(getRealDeviceCaps());
  });

  after(async function () {
    await deleteSession();
  });

  it('should start a session without an app and print page source', async function () {
    const pageSource = await driver.getPageSource();
    // eslint-disable-next-line no-console
    console.log(pageSource);
  });
});
