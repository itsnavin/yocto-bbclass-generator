import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { defaults, templates, generate, taskFor, RELEASE } from '../src/generator.js';

const root = resolve('.fixtures');
await rm(root, { recursive: true, force: true });
await mkdir(root);
const manifest = [];
const cases = [];
for (const [template, options] of Object.entries(templates)) {
  if (template === 'custom') continue; // Never run user-editable custom code in parser CI.
  for (const language of template === 'asset' ? ['shell'] : ['shell', 'python']) {
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
  manifest.push({ directory: `case-${i}`, config, classPath: result.classPath, recipePath: result.recipePath, task: taskFor(config), target: result.target });
}
await writeFile(join(root, 'manifest.json'), JSON.stringify({ release: RELEASE, cases: manifest }, null, 2));
console.log(`Wrote ${manifest.length} fixed built-in fixtures; custom code excluded.`);
