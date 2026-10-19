import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

test('guided generation, advanced help, keyboard tabs and responsive layout', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const external = [];
  page.on('request', (r) => {
    // Some Windows hosts inject antivirus scripts before our HTML/CSP. They
    // aren't application requests; record the exclusion, don't change the host.
    if (process.platform === 'win32' && new URL(r.url()).hostname === 'local.adguard.org') {
      testInfo.annotations.push({ type: 'host-injection', description: r.url() });
    } else if (new URL(r.url()).origin !== new URL(testInfo.project.use.baseURL).origin) external.push(r.url());
  });
  await page.goto('./');
  await expect(page).toHaveTitle(/Classcraft/);
  await expect(page.locator('#code')).toContainText('python do_recipe_audit_report()');
  await expect(page.locator('#validation')).toContainText('not a BitBake parse');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('system-ui');
  await page.locator('#name').fill('team_audit');
  await expect(page.locator('#code')).toContainText('do_team_audit_report');
  await page.locator('#advanced summary').click();
  await expect(page.locator('#nostamp-help')).toBeVisible();
  await page.getByRole('button', { name: '+ Add variable' }).click();
  await page.getByLabel('Variable name', { exact: true }).fill('TEAM_MESSAGE');
  await page.getByLabel('Value (empty is allowed)').fill('hello ${PN}');
  await page.getByLabel('Override condition (optional)').fill('class-native');
  await expect(page.locator('#code')).toContainText('TEAM_MESSAGE:class-native ?= "hello ${PN}"');
  await page.locator('#tab-class').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-recipe')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#code')).toContainText('inherit allarch nopackages team_audit');
  await page.keyboard.press('End');
  await expect(page.locator('#code')).toContainText('bitbake -g team-audit-example');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('invalid inputs block downloads and restore without losing input', async ({ page }) => {
  await page.goto('./');
  await page.locator('#name').fill('../bad');
  await expect(page.locator('#validation')).toContainText('generation paused');
  await expect(page.locator('#bundle')).toBeDisabled();
  await expect(page.locator('#copy')).toBeDisabled();
  await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#name').fill('good_class');
  await expect(page.locator('#bundle')).toBeEnabled();
  await page.locator('#advanced summary').click();
  await page.getByRole('button', { name: '+ Add variable' }).click();
  await page.getByLabel('Variable name', { exact: true }).fill('MY_VALUE');
  await page.getByLabel('Value (empty is allowed)').fill('${@bad()}');
  await expect(page.locator('#validation')).toContainText('non-simple');
  await expect(page.locator('#bundle')).toBeDisabled();
  await page.getByRole('button', { name: /Remove variable/ }).click();
  await expect(page.locator('#bundle')).toBeEnabled();
});

test('asset ZIP and individual download contain coherent source and class', async ({ page }) => {
  await page.goto('./');
  await page.locator('#template').selectOption('asset');
  await page.locator('#asset').fill('test-data.txt');
  await expect(page.locator('#language')).toBeDisabled();
  await expect(page.locator('#code')).toContainText('after do_install before do_package');
  const downloaded = page.waitForEvent('download');
  await page.locator('#bundle').click();
  const zip = await downloaded;
  expect(zip.suggestedFilename()).toBe('meta-classcraft.zip');
  const contents = unzipSync(await readFile(await zip.path()));
  expect(strFromU8(contents['meta-classcraft/recipes-examples/classcraft/files/test-data.txt'])).toContain('Hello from');
  expect(strFromU8(contents['meta-classcraft/classes-recipe/recipe_audit.bbclass'])).toContain('RECIPE_AUDIT_ASSET ?= "test-data.txt"');
  expect(strFromU8(contents['meta-classcraft/conf/layer.conf'])).toContain('scarthgap');
  const single = page.waitForEvent('download');
  await page.locator('#download').click();
  const file = await single;
  expect(file.suggestedFilename()).toBe('recipe_audit.bbclass');
  expect(await readFile(await file.path(), 'utf8')).toContain('install -m 0644');
});

test('global scope cannot leak recipe tasks or inheritance and can return to recipe', async ({ page }) => {
  await page.goto('./');
  await page.locator('#scope').selectOption('global');
  await expect(page.locator('#task-section')).toBeHidden();
  await expect(page.locator('#code')).not.toContainText('addtask');
  await expect(page.locator('#filename')).toContainText('classes-global');
  await page.locator('#tab-guide').click();
  await expect(page.locator('#code')).toContainText('INHERIT += "recipe_audit"');
  await page.locator('#scope').selectOption('recipe');
  await expect(page.locator('#task-section')).toBeVisible();
});

test('custom code stays inert text and carries a clear limitation', async ({ page }) => {
  await page.goto('./');
  await page.locator('#template').selectOption('custom');
  const code = '<img src=x onerror="alert(1)">\nbb.note("trusted only")';
  await page.locator('#body').fill(code);
  await expect(page.locator('#code')).toContainText(code.split('\n')[0]);
  await expect(page.locator('#validation')).toContainText('NOT parsed or safety-checked');
  await expect(page.locator('#preview img')).toHaveCount(0);
});

test('clipboard success or explicit denied-permission feedback', async ({ page, browserName }, testInfo) => {
  await page.goto('./');
  if (testInfo.project.name === 'desktop' && browserName === 'chromium') {
    await page.locator('#copy').click();
    await expect(page.locator('#action-status')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('do_recipe_audit_report');
  } else {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    }));
    await page.locator('#copy').click();
    await expect(page.locator('#action-status')).toContainText('Clipboard unavailable');
  }
});

test('advanced controls wire language, ordering, dependency namespaces and signatures', async ({ page }) => {
  await page.goto('./');
  await page.locator('#language').selectOption('shell');
  await page.locator('#advanced summary').click();
  for (const [id, value] of [
    ['inherits', 'pkgconfig'], ['build-depends', 'zlib'], ['after', 'do_fetch'],
    ['before', 'do_build'], ['dirs', '${WORKDIR}/audit'],
    ['task-depends', 'zlib-native:do_populate_sysroot'],
    ['task-rdepends', 'demo-package:do_packagedata'], ['vardeps', 'PN PV'],
  ]) await page.locator(`#${id}`).fill(value);
  await page.locator('#nostamp').check();
  for (const line of [
    'inherit pkgconfig', 'DEPENDS += "zlib"', 'bbnote "Recipe:',
    'after do_fetch before do_build', '[dirs] += "${WORKDIR}/audit"',
    '[depends] += "zlib-native:do_populate_sysroot"',
    '[rdepends] += "demo-package:do_packagedata"', '[vardeps] += "PN PV"', '[nostamp] = "1"',
  ]) await expect(page.locator('#code')).toContainText(line);
  await page.locator('#template').selectOption('asset');
  await page.locator('#runtime-depends').fill('zlib');
  await expect(page.locator('#code')).toContainText('RDEPENDS:${PN} += "zlib"');
  await expect(page.locator('#code')).toContainText('fakeroot do_recipe_audit_install_asset');
});
