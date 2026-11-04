import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startGuiFixture} from '../../leafseamer-controller/test/gui-browser-fixture.mjs';

// 浏览器运行库与可执行文件由测试环境显式提供，不属于GUI运行依赖。
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 4) throw new Error('browser_check_arguments');
const {chromium} = createRequire(import.meta.url)(path.resolve(process.argv[2]));
const output = path.join(root, 'logs/gui-session'); fs.mkdirSync(output, {recursive: true});
const fixture = await startGuiFixture(root); let browser, restricted;
const errors = [], requests = [], checks = [];
try {
  browser = await chromium.launch({executablePath: path.resolve(process.argv[3]), headless: true,
    args: ['--ignore-certificate-errors-spki-list=' + fixture.spki]});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, locale: 'zh-CN'}), page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push({method: r.method(), path: new URL(r.url()).pathname}));
  assert.equal((await page.goto(fixture.origin)).status(), 200);
  await page.getByRole('heading', {name: '登录工作台'}).waitFor(); checks.push('首次加载与严格CSP');
  await page.getByLabel('用户名', {exact: true}).focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').getAttribute('name'), 'password'); checks.push('键盘表单焦点顺序');
  const login = async password => { await page.getByLabel('用户名', {exact: true}).fill(fixture.login.login);
    await page.getByLabel('密码', {exact: true}).fill(password); await page.getByRole('button', {name: '登录', exact: true}).click(); };
  await login('synthetic-wrong-password'); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('密码', {exact: true}).inputValue(), ''); checks.push('错误密码拒绝并清空表单');
  await login(fixture.login.password);
  await page.getByText('保护中', {exact: true}).waitFor(); assert.equal(await page.getByText('测试设备', {exact: true}).count(), 2);
  const cookies = await context.cookies(); assert.equal(cookies.length, 1);
  assert(cookies[0].secure && cookies[0].httpOnly); assert.equal(cookies[0].sameSite, 'Strict'); assert.equal(cookies[0].path, '/auth');
  checks.push('实际HTTPS登录、浏览器受限Cookie、SQLite设备与控制记录');
  await page.screenshot({path: path.join(output, 'desktop.png'), fullPage: true});
  const storage = await page.evaluate(() => ({local: Object.keys(localStorage), session: Object.keys(sessionStorage), cookie: document.cookie}));
  assert.deepEqual(storage, {local: [], session: [], cookie: ''}); checks.push('凭据不进入网页可读Cookie或持久化存储');
  await page.getByRole('button', {name: '当前会话', exact: true}).click();
  await page.getByRole('button', {name: '续期会话', exact: true}).click();
  await page.getByRole('button', {name: '退出登录', exact: true}).waitFor({state: 'visible'});
  await page.getByRole('button', {name: '设备工作台', exact: true}).click();
  await page.getByText('尚未读取设备目录', {exact: true}).waitFor();
  await page.getByRole('button', {name: '刷新', exact: true}).click(); await page.getByText('保护中', {exact: true}).waitFor(); checks.push('显式续期后重新读取');
  await page.getByRole('button', {name: 'English', exact: true}).click(); await page.getByRole('heading', {name: 'Device workspace'}).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.getByRole('button', {name: 'Switch theme', exact: true}).click(); assert.equal(await page.locator('.app').getAttribute('data-theme'), 'dark');
  await page.setViewportSize({width: 390, height: 844});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: path.join(output, 'mobile-dark.png'), fullPage: true}); checks.push('英语、深色主题和390像素布局');
  await page.getByRole('button', {name: 'Sign out', exact: true}).click(); await page.getByRole('heading', {name: 'Sign in to your workspace'}).waitFor();
  assert.match(await page.getByRole('alert').innerText(), /propagation/); assert.equal((await context.cookies()).length, 0); checks.push('退出清除Cookie与本地状态，保留远端传播待确认');
  await page.reload(); await page.getByRole('heading', {name: 'Sign in to your workspace'}).waitFor(); assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('.app').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', {name: '简体中文', exact: true}).click();
  fixture.state.failed = true; await login(fixture.login.password); await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('heading', {name: '登录工作台'}).count(), 1); checks.push('资格失效时拒绝登录');
  assert.deepEqual(errors, []); assert(requests.every(r => !r.path.includes('commands')));
  await browser.close(); browser = null; await fixture.close();
  restricted = await startGuiFixture(root, {readPermissions: false});
  browser = await chromium.launch({executablePath: path.resolve(process.argv[3]), headless: true,
    args: ['--ignore-certificate-errors-spki-list=' + restricted.spki]});
  const limited = await browser.newContext({viewport: {width: 1440, height: 900}}), limitedPage = await limited.newPage(), limitedRequests = [];
  limitedPage.on('request', request => limitedRequests.push(new URL(request.url()).pathname)); limitedPage.on('pageerror', e => errors.push(e.message));
  await limitedPage.goto(restricted.origin);
  await limitedPage.getByLabel('用户名', {exact: true}).fill(restricted.login.login); await limitedPage.getByLabel('密码', {exact: true}).fill(restricted.login.password);
  await limitedPage.getByRole('button', {name: '登录', exact: true}).click(); await limitedPage.getByRole('alert').waitFor();
  assert.match(await limitedPage.getByRole('alert').innerText(), /没有读取/); assert.equal(await limitedPage.getByText('测试设备', {exact: true}).count(), 0);
  assert(!limitedRequests.some(route => route.includes('/devices'))); checks.push('真实人员权限不足时不读取或伪造设备'); assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({checks, errors, requests, synthetic: true, real_devices: false}, null, 2) + '\n');
  console.log(JSON.stringify({checks: checks.length, errors: errors.length}));
} catch (error) {
  fs.writeFileSync(path.join(output, 'browser-failure.txt'), String(error.stack)); throw error;
} finally { await browser?.close(); await fixture.close(); await restricted?.close(); }
