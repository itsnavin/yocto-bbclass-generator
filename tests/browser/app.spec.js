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
  await page.keyboard.press('ArrowRight');
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

test('hooks, exports, anonymous operations and recipe variants generate real metadata', async ({ page }) => {
  await page.goto('./');
  await page.locator('#advanced summary').click();
  await expect(page.locator('#hooks-help')).toBeVisible();
  await page.locator('#hooks').selectOption('both');
  await page.locator('#export-functions').check();
  await page.locator('#anonymous').selectOption('default');
  await page.locator('#anonymous-variable').fill('TEAM_LABEL');
  await page.locator('#anonymous-value').fill('ready');
  await page.locator('#variants').selectOption('both');
  for (const expected of [
    'do_recipe_audit_report[prefuncs] += "recipe_audit_pre_hook"',
    'do_recipe_audit_report[postfuncs] += "recipe_audit_post_hook"',
    'python recipe_audit_do_recipe_audit_report()',
    'EXPORT_FUNCTIONS do_recipe_audit_report',
    'python () {', 'd.setVar("TEAM_LABEL", "ready")',
  ]) await expect(page.locator('#code')).toContainText(expected);
  await page.locator('#tab-recipe').click();
  await expect(page.locator('#code')).toContainText('BBCLASSEXTEND = "native nativesdk"');
  await expect(page.locator('#code')).toContainText('bb.build.exec_func("recipe_audit_do_recipe_audit_report", d)');
  await expect(page.locator('#code')).not.toContainText('allarch');
  await page.locator('#anonymous').selectOption('require');
  await expect(page.locator('#code')).toContainText('TEAM_LABEL = "ready"');
  await page.locator('#language').selectOption('shell');
  await expect(page.locator('#code')).toContainText('    recipe_audit_do_recipe_audit_report');
  await page.locator('#tab-class').click();
  await expect(page.locator('#code')).toContainText('bbnote "Recipe:');
  await expect(page.locator('#code')).toContainText('bb.fatal("TEAM_LABEL');
});

test('override operations keep conditional syntax and explicit separators', async ({ page }) => {
  await page.goto('./');
  await page.locator('#advanced summary').click();
  await page.getByRole('button', { name: '+ Add variable' }).click();
  await page.getByLabel('Variable name', { exact: true }).fill('TEAM_LIST');
  await page.getByLabel('Variable operation', { exact: true }).selectOption('append');
  await page.getByLabel('Override condition (optional)').fill('class-native');
  await page.getByLabel('Value (empty is allowed)').fill(' extra');
  await expect(page.getByLabel('Assignment operator')).toBeDisabled();
  await expect(page.locator('#code')).toContainText('TEAM_LIST:append:class-native = " extra"');
  await page.getByLabel('Variable operation', { exact: true }).selectOption('remove');
  await expect(page.locator('#code')).toContainText('TEAM_LIST:remove:class-native = " extra"');
});

for (const template of ['config', 'service']) {
  test(`${template} packaging controls and downloaded files are coherent`, async ({ page }) => {
    await page.goto('./');
    await page.locator('#advanced summary').click();
    await page.locator('#variants').selectOption('native');
    await page.locator('#export-functions').check();
    await page.locator('#template').selectOption(template);
    await expect(page.locator('#variants')).toHaveValue('none');
    await expect(page.locator('#variants')).toBeDisabled();
    await expect(page.locator('#export-functions')).not.toBeChecked();
    await expect(page.locator('#export-functions')).toBeDisabled();
    if (template === 'config') {
      await page.locator('#config-file').fill('settings.conf');
      await page.locator('#install-subdir').fill('team/demo');
      await page.locator('#install-mode').selectOption('0600');
      await expect(page.locator('#code')).toContainText('CONFFILES:${PN} += "${sysconfdir}/team/demo/settings.conf"');
      await expect(page.locator('#code')).toContainText('install -m 0600');
    } else {
      await page.locator('#service-file').fill('team-demo.service');
      await page.locator('#service-enable').selectOption('preset');
      await expect(page.locator('#code')).toContainText('inherit systemd features_check');
      await expect(page.locator('#code')).toContainText('SYSTEMD_SERVICE:${PN} = "team-demo.service"');
      await expect(page.locator('#code')).toContainText('SYSTEMD_AUTO_ENABLE:${PN} = "preset"');
      await expect(page.locator('#code')).toContainText('RDEPENDS:${PN} += "coreutils"');
    }
    const downloaded = page.waitForEvent('download');
    await page.locator('#bundle').click();
    const zip = await downloaded;
    const contents = unzipSync(await readFile(await zip.path()));
    const filename = template === 'config' ? 'settings.conf' : 'team-demo.service.in';
    const source = `recipes-examples/classcraft/files/${filename}`;
    expect(strFromU8(contents[`meta-classcraft/${source}`])).toContain(template === 'config' ? 'message=' : 'ExecStart=@BASE_BINDIR@/true');
    await page.locator('#tab-files').click();
    await page.locator('#artifact').selectOption(source);
    await expect(page.locator('#code')).toContainText(template === 'config' ? 'message=' : '[Service]');
    const single = page.waitForEvent('download');
    await page.locator('#download').click();
    expect((await single).suggestedFilename()).toBe(filename);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#inherits').fill('native');
    await expect(page.locator('#validation')).toContainText('managed variants/service');
    await expect(page.locator('#bundle')).toBeDisabled();
  });
}

test('custom anonymous Python is inert, clearly warned and suppressed in global mode', async ({ page }) => {
  await page.goto('./');
  await page.locator('#advanced summary').click();
  await page.locator('#anonymous').selectOption('custom');
  const body = '# <img src=x onerror="alert(1)">\nd.setVar("USER_CODE", "not run")';
  await page.locator('#anonymous-body').fill(body);
  await expect(page.locator('#code')).toContainText('d.setVar("USER_CODE", "not run")');
  await expect(page.locator('#validation')).toContainText('anonymous code runs at BitBake parse time');
  await expect(page.locator('#preview img')).toHaveCount(0);
  await page.locator('#scope').selectOption('global');
  await expect(page.locator('#code')).not.toContainText('python ()');
  await expect(page.locator('#code')).not.toContainText('USER_CODE');
});
