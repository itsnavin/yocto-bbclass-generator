import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { defaults, templates, generate, taskFor, RELEASE, isPackaged } from '../src/generator.js';

const root = resolve('.fixtures');
await rm(root, { recursive: true, force: true });
await mkdir(root);
const manifest = [];
const cases = [];
for (const [template, options] of Object.entries(templates)) {
  if (template === 'custom') continue; // Never run user-editable custom code in parser CI.
  for (const language of isPackaged({ template }) ? ['shell'] : ['shell', 'python']) {
    for (const location of ['scoped', 'shared']) cases.push({ ...defaults(), ...options, template, language, location });
  }
}
cases.push({ ...defaults(), scope: 'global', variables: [{ name: 'FIXTURE_GLOBAL', value: 'yes', operator: '?=', override: '' }] });
cases.push({
  ...defaults(), name: 'flags_fixture',
  dirs: '${WORKDIR}/audit ${B}/logs', taskDepends: 'zlib-native:do_populate_sysroot',
  taskRdepends: 'demo-package:do_packagedata', vardeps: 'PN MY_INPUT', nostamp: true,
  buildDepends: 'zlib virtual/libgl', inherits: 'fixture_helper',
  variables: [
    { name: 'FIXTURE_ASSIGN', value: '${PN}', operator: '=', override: '' },
    { name: 'FIXTURE_DEFAULT', value: "it's fine", operator: '?=', override: '' },
    { name: 'FIXTURE_WEAK', value: 'weak', operator: '??=', override: '' },
    { name: 'FIXTURE_IMMEDIATE', value: '${PV}', operator: ':=', override: '' },
    { name: 'FIXTURE_OVERRIDE', value: 'say "hello"', operator: '=', override: 'class-target' },
  ],
});
for (const language of ['shell', 'python']) {
  for (const template of ['report', 'preflight']) {
    for (const hooks of ['pre', 'post', 'both']) {
      cases.push({ ...defaults(), ...templates[template], template, language, hooks, exportFunctions: true });
    }
  }
}
for (const anonymous of ['default', 'require']) {
  cases.push({ ...defaults(), anonymous, anonymousValue: 'say "hello"' });
}
for (const variants of ['native', 'nativesdk', 'both']) {
  for (const template of ['report', 'preflight']) {
    for (const language of ['shell', 'python']) {
      cases.push({
        ...defaults(), ...templates[template], template, language, variants,
        anonymous: 'default', hooks: 'both', exportFunctions: true,
        variables: [
          { name: 'FIXTURE_LIST', value: 'base drop', operator: '=', override: '' },
          { name: 'FIXTURE_LIST', operation: 'append', value: ' native', operator: '=', override: 'class-native' },
          { name: 'FIXTURE_LIST', operation: 'prepend', value: 'sdk ', operator: '=', override: 'class-nativesdk' },
          { name: 'FIXTURE_LIST', operation: 'remove', value: 'drop', operator: '=', override: '' },
        ],
      });
    }
  }
}
for (const template of ['asset', 'config']) {
  for (const installMode of ['0600', '0644']) {
    cases.push({
      ...defaults(), ...templates[template], template, installMode, installSubdir: 'company/demo',
      runtimeDepends: 'demo-package', hooks: 'both',
    });
  }
}
for (const serviceEnable of ['enable', 'disable', 'mask', 'preset']) {
  cases.push({ ...defaults(), ...templates.service, template: 'service', serviceEnable, hooks: 'both' });
}
cases.push({
  ...defaults(), template: 'asset', language: 'shell', after: 'do_install', before: 'do_package do_populate_sysroot',
  name: 'runtime_fixture', runtimeDepends: 'demo-package',
});
for (const [i, config] of cases.entries()) {
  const result = generate(config);
  if (result.errors.length) throw new Error(JSON.stringify(result.errors));
  const path = join(root, `case-${i}`);
  for (const [file, text] of Object.entries(result.files)) {
    const absolute = join(path, ...file.split('/'));
    await mkdir(resolve(absolute, '..'), { recursive: true });
    await writeFile(absolute, text);
  }
  let defaultRecipePath = null;
  if (config.exportFunctions) {
    defaultRecipePath = result.recipePath.replace('_1.0.bb', '-default_1.0.bb');
    await writeFile(join(path, ...defaultRecipePath.split('/')), result.files[result.recipePath].split('# A recipe replacement')[0]);
  }
  manifest.push({ directory: `case-${i}`, config, classPath: result.classPath, recipePath: result.recipePath, defaultRecipePath, task: taskFor(config), target: result.target });
}
await writeFile(join(root, 'manifest.json'), JSON.stringify({ release: RELEASE, cases: manifest }, null, 2));
console.log(`Wrote ${manifest.length} fixed built-in fixtures; custom code excluded.`);
