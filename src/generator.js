import { strToU8, zipSync } from 'fflate';

export const RELEASE = Object.freeze({
  yocto: '5.0.13',
  series: 'scarthgap',
  bitbake: '2.8.1',
  commit: 'f16cffd030d21d12dd57bb95cfc310bda41f8a1f',
  tagObject: '529843b1c189ab7b133b7fdf197d4b2a4b71a6db',
});

export const templates = Object.freeze({
  report: {
    description: 'Log PN, PV and MACHINE after patching and before configuration. A no-source sample recipe demonstrates the task without requiring an image or compiler.',
    after: 'do_patch', before: 'do_configure', language: 'python',
  },
  preflight: {
    description: 'Fail with a useful error if the class-specific REQUIRED_VALUE is empty. The sample recipe supplies it. Runs after patching, before configuration; no source inspection or host commands.',
    after: 'do_patch', before: 'do_configure', language: 'python',
  },
  asset: {
    description: 'Install a supplied text file into the target staging directory after do_install, before packaging and sysroot staging. Uses fakeroot and its native provider to preserve target ownership. The class declares its file:// source and package path; the bundle includes the asset. Does not replace do_install.',
    after: 'do_install', before: 'do_package do_populate_sysroot', language: 'shell',
  },
  custom: {
    description: 'Write one namespaced shell or Python task. Review ordering and every input yourself. The no-source sample is a scaffold, not proof your custom code can build.',
    after: 'do_patch', before: 'do_configure', language: 'python',
  },
});

export function defaults() {
  return {
    scope: 'recipe', template: 'report', name: 'recipe_audit', location: 'scoped',
    language: 'python', body: 'bb.note("Hello from " + d.getVar("PN"))',
    asset: 'example.txt', variables: [], inherits: '', buildDepends: '', runtimeDepends: '',
    after: 'do_patch', before: 'do_configure', dirs: '', taskDepends: '',
    taskRdepends: '', vardeps: '', nostamp: false,
  };
}

const identifier = /^[A-Z][A-Z0-9_]*$/;
const provider = /^[a-z0-9][a-z0-9+.-]*(?:\/[a-z0-9][a-z0-9+.-]*)?$/;
const className = /^[a-z][a-z0-9_]{0,47}$/;
const taskName = /^do_[a-z][a-z0-9_]*$/;
const oneLine = (s) => typeof s === 'string' && !/[\x00-\x1f\x7f\u2028\u2029]/.test(s);
const tokens = (s) => s.trim() ? s.trim().split(/ +/) : [];
export const taskFor = (c) => `do_${c.name}_${c.template === 'asset' ? 'install_asset' : c.template}`;
export const classDirectory = (c) => c.location === 'shared' ? 'classes' : `classes-${c.scope}`;

function metadataValue(value) {
  if (!oneLine(value) || /\\/.test(value) || (value.includes('"') && value.includes("'"))) return false;
  // Only simple, deferred datastore references in structured values, never inline Python.
  return !/\$\{/.test(value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''));
}

function quoted(value) {
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

export function validate(c) {
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  if (!className.test(c.name) || ['base', 'allarch', 'nopackages'].includes(c.name)) {
    fail('name', 'Class name: use 1–48 lowercase letters/digits/underscores, starting with a letter; base, allarch and nopackages are reserved here.');
  }
  if (!['recipe', 'global'].includes(c.scope)) fail('scope', 'Choose recipe or global scope.');
  if (!['scoped', 'shared'].includes(c.location)) fail('location', 'Choose a supported class directory.');
  if (!Array.isArray(c.variables) || c.variables.length > 20) {
    fail('variables', 'At most 20 variable declarations are supported.');
  } else {
    const seen = new Set();
    c.variables.forEach((v, i) => {
      const prefix = `Variable ${i + 1}`;
      if (!identifier.test(v.name)) fail(`var-${i}-name`, `${prefix}: use an uppercase variable identifier.`);
      if (!['=', '?=', '??=', ':='].includes(v.operator)) fail(`var-${i}-operator`, `${prefix}: unsupported assignment operator.`);
      if (!oneLine(v.override) || (v.override !== '' && !v.override.split(':').every((t) => /^[a-z0-9][a-z0-9-]*$/.test(t) && !['append', 'prepend', 'remove'].includes(t)))) {
        fail(`var-${i}-override`, `${prefix}: override conditions must be lowercase tokens separated by colons, not override operations.`);
      }
      if (!metadataValue(v.value)) fail(`var-${i}-value`, `${prefix}: use a single line without backslashes, mixed quotes, or non-simple \${...} expansions.`);
      const key = `${v.name}:${v.override}`;
      if (seen.has(key)) fail(`var-${i}-name`, `${prefix}: duplicate declaration; use one declaration per variable/override combination.`);
      seen.add(key);
      if (/^(BBPATH|BBFILES|BBLAYERS|BBFILE_.+|LAYERSERIES_.+|INHERIT|OVERRIDES|SRC_URI|FILES|DEPENDS|RDEPENDS|S|B|D|T|WORKDIR|PN|BPN|PV|LICENSE|LIC_FILES_CHKSUM)$/.test(v.name) ||
          ['ASSET', 'REQUIRED_VALUE'].some((suffix) => v.name === `${c.name.toUpperCase()}_${suffix}`)) {
        fail(`var-${i}-name`, `${prefix}: this generator reserves build plumbing and template contract variables. Use a class-specific variable instead.`);
      }
    });
  }
  if (c.scope !== 'recipe') return errors;
  if (!Object.hasOwn(templates, c.template)) fail('template', 'Choose a supported template.');
  if (!['shell', 'python'].includes(c.language)) fail('language', 'Choose shell or BitBake Python.');
  if (c.template === 'asset' && c.language !== 'shell') fail('language', 'The asset template requires shell.');
  if (c.template === 'asset' && (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.txt$/.test(c.asset) || c.asset.length > 80)) {
    fail('asset', 'Asset: use a simple filename ending in .txt (letters, digits, underscores, hyphens), at most 80 characters.');
  }
  const list = (field, value, regex, description) => {
    if (!oneLine(value) || !tokens(value).every((t) => regex.test(t))) fail(field, description);
  };
  list('inherits', c.inherits, /^[a-z][a-z0-9_-]*$/, 'Inheritance: space-separated lowercase class names only.');
  if (oneLine(c.inherits) && tokens(c.inherits).includes(c.name)) fail('inherits', 'A class cannot inherit itself.');
  list('build-depends', c.buildDepends, provider, 'DEPENDS: space-separated recipe/provider names only, no versions or metadata expressions.');
  list('runtime-depends', c.runtimeDepends, /^[a-z0-9][a-z0-9+.-]*$/, 'RDEPENDS: space-separated package names only.');
  if (c.runtimeDepends && c.template !== 'asset') fail('runtime-depends', 'Runtime package metadata is available only for the asset template, which creates a package.');
  list('after', c.after, taskName, 'After: space-separated full do_task identifiers only.');
  list('before', c.before, taskName, 'Before: space-separated full do_task identifiers only.');
  if (oneLine(c.before) && !tokens(c.before).length) fail('before', 'Keep at least one before task so the generated task is reachable in a normal build.');
  if (oneLine(c.before) && oneLine(c.after)) {
    const before = tokens(c.before), after = tokens(c.after), own = taskFor(c);
    if ([...before, ...after].includes(own) || before.some((t) => after.includes(t))) fail('before', 'Ordering cannot refer to this task itself or place the same task both before and after.');
    const chain = ['do_fetch', 'do_unpack', 'do_patch', 'do_prepare_recipe_sysroot', 'do_configure', 'do_compile', 'do_install', 'do_package', 'do_packagedata', 'do_build'];
    if (before.some((b) => after.some((a) => chain.includes(a) && chain.includes(b) && chain.indexOf(a) >= chain.indexOf(b)))) {
      fail('after', 'Ordering contradicts the standard recipe task chain. Choose earlier after tasks and later before tasks.');
    }
    if (c.template === 'asset' && (c.after !== 'do_install' || c.before !== 'do_package do_populate_sysroot')) fail('after', 'Asset installation must stay after do_install and before do_package and do_populate_sysroot.');
  }
  list('dirs', c.dirs, /^\$\{(?:WORKDIR|B)\}(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/, 'dirs: use ${WORKDIR} or ${B} with simple subdirectories, without traversal.');
  if (oneLine(c.dirs) && tokens(c.dirs).some((p) => p.split('/').some((part) => ['.', '..'].includes(part)))) fail('dirs', 'dirs cannot contain traversal segments.');
  const edge = /^[a-z0-9][a-z0-9+.-]*(?:\/[a-z0-9][a-z0-9+.-]*)?:do_[a-z][a-z0-9_]*$/;
  list('task-depends', c.taskDepends, edge, 'depends: space-separated recipe:do_task pairs only.');
  list('task-rdepends', c.taskRdepends, /^[a-z0-9][a-z0-9+.-]*:do_[a-z][a-z0-9_]*$/, 'rdepends: space-separated package:do_task pairs only.');
  list('vardeps', c.vardeps, identifier, 'vardeps: space-separated uppercase variable identifiers only.');
  if (typeof c.nostamp !== 'boolean') fail('nostamp', 'nostamp must be a boolean.');
  if (c.template === 'custom' && (typeof c.body !== 'string' || !c.body.trim() || /[\x00\r]/.test(c.body) || c.body.length > 32000)) {
    fail('body', 'Custom code must be nonempty, at most 32,000 characters, without NUL or carriage returns. Syntax is not checked.');
  }
  return errors;
}

function functionBody(c) {
  const prefix = c.name.toUpperCase();
  if (c.template === 'custom') return c.body;
  if (c.template === 'asset') return [
    'install -d "${D}${datadir}/${BPN}"',
    `install -m 0644 "\${WORKDIR}/\${${prefix}_ASSET}" "\${D}\${datadir}/\${BPN}/\${${prefix}_ASSET}"`,
  ].join('\n');
  if (c.template === 'preflight') return c.language === 'python'
    ? `value = d.getVar("${prefix}_REQUIRED_VALUE")\nif not value:\n    bb.fatal("${prefix}_REQUIRED_VALUE must be set by the inheriting recipe")\nbb.note("Preflight passed for " + d.getVar("PN"))`
    : `if [ -z "\${${prefix}_REQUIRED_VALUE}" ]; then\n    bbfatal "${prefix}_REQUIRED_VALUE must be set by the inheriting recipe"\nfi\nbbnote "Preflight passed for \${PN}"`;
  return c.language === 'python'
    ? 'bb.note("Recipe: %s %s | machine: %s" % (d.getVar("PN"), d.getVar("PV"), d.getVar("MACHINE")))'
    : 'bbnote "Recipe: ${PN} ${PV} | machine: ${MACHINE}"';
}

function recipe(c) {
  const lines = [
    'SUMMARY = "Generated class demonstration"',
    'LICENSE = "MIT"',
    'LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"',
    '',
    `inherit allarch${c.scope === 'recipe' && c.template === 'asset' ? '' : ' nopackages'}${c.scope === 'recipe' ? ` ${c.name}` : ''}`,
    '',
    'S = "${WORKDIR}"',
    'do_configure[noexec] = "1"',
    'do_compile[noexec] = "1"',
    'do_install[noexec] = "1"',
  ];
  if (c.scope === 'global') lines.push('', `# Enable via INHERIT += "${c.name}" in conf/local.conf, not inherit here.`, '# This no-source recipe is only a metadata inspection target.');
  else if (c.template === 'preflight') lines.push('', `${c.name.toUpperCase()}_REQUIRED_VALUE = "example-value"`);
  else if (c.template !== 'asset') lines.push('', '# No source is needed for this demonstration.', 'SRC_URI = ""');
  if (c.template === 'custom' && c.scope === 'recipe') lines.push('# Adapt sources, dependencies, architecture and disabled tasks for your custom code.');
  return lines.join('\n') + '\n';
}

function usage(c, target, directory) {
  const global = c.scope === 'global';
  const task = taskFor(c);
  return `# ${c.name}: generated starter layer

Target: Yocto ${RELEASE.yocto} Scarthgap, bundled BitBake ${RELEASE.bitbake}.
Poky commit: ${RELEASE.commit}
Annotated tag object (not a commit): ${RELEASE.tagObject}

## Trust and limits

This class affects ${global ? 'all recipes exposed to global inheritance' : 'every inheriting recipe'}.
Review all metadata before running BitBake. Custom code is executable metadata,
not sanitized or validated code. Neither the browser nor generator executes it.
Structured-field checks do not resolve the BitBake datastore, providers, file
availability, signatures, task graph, source licensing or cross-toolchain behavior.
Anonymous Python in inherited metadata can run even during parsing.

## Install

Extract the ZIP; it contains meta-classcraft/. Keep that directory name unless
you also update its layer collection metadata. It requires the existing core layer.
Place the class in ${directory}/${c.name}.bbclass within your own layer if
not using this starter layer; preserve the supplied recipe/files layout.

In an initialized Scarthgap build shell, replace /path/to with your extraction path:

\`\`\`sh
bitbake-layers add-layer /path/to/meta-classcraft
${global ? `# Add this line to build/conf/local.conf (do not enter as a shell command):\n# INHERIT += "${c.name}"` : `# The supplied recipe uses: inherit ${c.name}`}
bitbake-layers show-layers
bitbake-layers show-recipes
bitbake -p
bitbake -e ${target} > ${target}.env
bitbake -c listtasks ${target}
bitbake -g ${target}
${global ? '# Global metadata has no generated task; inspect the variables in the .env file.' : `# After review, intentionally execute the generated task and its prerequisites:\nbitbake -c ${task.slice(3)} ${target}`}
bitbake ${target}
\`\`\`

The built-in sample needs no real image/provider target. The asset template includes
files/${c.asset} only when selected; its class adds file:// to SRC_URI. Non-asset
examples intentionally have no source and inherit nopackages. All samples disable
configure/compile/install; the asset class has its own task after do_install and
before do_package and do_populate_sysroot, staging under \${D}\${datadir}/\${BPN}
and extending FILES:\${PN}. Its fakeroot task has an explicit native fakeroot
provider dependency so installed files get target ownership in a real build.
The custom example is a scaffold: adapt its sources, architecture, disabled tasks
and dependencies for your code. Supplied demo text is MIT licensed. The recipe
uses Poky's common MIT license; replace LICENSE/LIC_FILES_CHKSUM for real sources.
Do not claim your own source is MIT without checking its license.

## Inspect results

Check the .env file for final assignments and active overrides. Confirm the task
in listtasks and inspect task-depends.dot from -g for expected edges and cycles.
After execution inspect \${T}/log.${global ? 'do_*' : task} and run.${global ? 'do_*' : task}
(including PID-suffixed files); find T with bitbake -e ${target}.
${c.template === 'asset' && !global ? 'Inspect the staged file under ${D}${datadir}/${BPN} and package contents.\n' : ''}
Parsing alone is not a successful build. Graph generation is not task execution.
Build in a supported Linux environment configured for your MACHINE/DISTRO.

## Metadata semantics

= assigns with deferred expansion. ?= sets an undefined variable at parse time
(first such default wins). ??= provides a replaceable weak fallback (last weak
default wins), used only absent other assignment. := expands immediately, keeping
references that are still undefined. Quotes do not suppress BitBake expansion.
Modern colon overrides act only for active OVERRIDES; inspect BitBake's result.
Inheritance order and assignment placement can change final values.

Scoped classes-${c.scope}/ is searched before shared classes/ across BBPATH;
within each search, earlier BBPATH layers can shadow later classes.
Recipe context uses inherit; global configuration uses INHERIT. Do not globally
inherit a recipe task class. Global output here deliberately has no tasks.

addtask after supplies prerequisites, before makes later tasks depend on this one.
An after edge alone does not add a task to the normal build. Extra classes can
alter the graph: the generator cannot prove acyclicity against unknown metadata.
DEPENDS refers to build-time recipes/sysroots; RDEPENDS:\${PN} to runtime packages.
[depends] uses recipe:do_task; [rdepends] uses package:do_task, not package
installation metadata. [dirs] preserves content and uses the last directory as cwd.
[vardeps] adds signature inputs static analysis might miss. Stamps skip up-to-date
tasks; [nostamp] reruns the task AND can force dependent tasks to rerun. No sstate
cache behavior is invented by this generator. No cleanup/QA bypasses are generated.

## More advanced patterns (reference only)

Anonymous python () runs at parse finalization: avoid nondeterministic I/O.
prefuncs/postfuncs name helpers inside a task, not new scheduled tasks.
EXPORT_FUNCTIONS requires classname_functionname implementations; recipes may
then call the class implementation from their replacements.
BBCLASSEXTEND = "native nativesdk" creates variants only if sources, dependencies
and packaging support them; do not blindly extend an allarch demo.
cleandirs deletes/recreates paths; deliberately not exposed by this generator.
Respect cross-compilation variables CC/CFLAGS/LDFLAGS; never invoke host gcc.

## Official references

https://docs.yoctoproject.org/5.0.13/ref-manual/structure.html
https://docs.yoctoproject.org/5.0.13/dev-manual/debugging.html
https://docs.yoctoproject.org/bitbake/2.8/bitbake-user-manual/bitbake-user-manual-metadata.html
https://github.com/yoctoproject/poky/blob/${RELEASE.commit}/bitbake/lib/bb/parse/parse_py/BBHandler.py
`;
}

export function generate(c) {
  const errors = validate(c);
  if (errors.length) return { errors, files: null };
  const prefix = c.name.toUpperCase();
  const directory = classDirectory(c);
  const target = `${c.name.replaceAll('_', '-')}-example`;
  const lines = [
    '# SPDX-License-Identifier: MIT',
    `# ${c.name}.bbclass | Yocto ${RELEASE.yocto} Scarthgap / BitBake ${RELEASE.bitbake}`,
    '# Affects every inheriting recipe. Review before running BitBake.',
    '',
  ];
  if (c.scope === 'recipe') {
    if (c.inherits.trim()) lines.push(`inherit ${tokens(c.inherits).join(' ')}`, '');
    if (c.template === 'preflight') lines.push(`${prefix}_REQUIRED_VALUE ?= ""`, '');
    if (c.template === 'asset') lines.push(
      `${prefix}_ASSET ?= "${c.asset}"`,
      `SRC_URI += " file://\${${prefix}_ASSET}"`,
      'FILES:${PN} += "${datadir}/${BPN}"', '',
    );
  }
  c.variables.forEach((v) => lines.push(`${v.name}${v.override ? `:${v.override}` : ''} ${v.operator} ${quoted(v.value)}`));
  if (c.variables.length) lines.push('');
  if (c.scope === 'recipe') {
    if (c.buildDepends.trim()) lines.push(`DEPENDS += "${tokens(c.buildDepends).join(' ')}"`, '');
    if (c.runtimeDepends.trim()) lines.push(`RDEPENDS:\${PN} += "${tokens(c.runtimeDepends).join(' ')}"`, '');
    const task = taskFor(c);
    if (c.template === 'custom') lines.push('# Trusted custom code: not parsed or security-validated by the generator.');
    lines.push(`${c.template === 'asset' ? 'fakeroot ' : ''}${c.language === 'python' ? 'python ' : ''}${task}() {`);
    lines.push(...functionBody(c).split('\n').map((line) => `    ${line}`), '}');
    if (c.template === 'asset') lines.push(`${task}[depends] += "virtual/fakeroot-native:do_populate_sysroot"`);
    const flags = { dirs: c.dirs, depends: c.taskDepends, rdepends: c.taskRdepends, vardeps: c.vardeps };
    for (const [flag, value] of Object.entries(flags)) {
      if (value.trim()) lines.push(`${task}[${flag}] += "${tokens(value).join(' ')}"`);
    }
    if (c.nostamp) lines.push('# WARNING: this task and its dependents may run on every build.', `${task}[nostamp] = "1"`);
    lines.push(`addtask ${task.slice(3)}${c.after.trim() ? ` after ${tokens(c.after).join(' ')}` : ''} before ${tokens(c.before).join(' ')}`);
  } else {
    lines.push('# Global metadata only. Enable in configuration via INHERIT.', '# No per-recipe tasks or additional inheritance are emitted.');
  }
  const classPath = `${directory}/${c.name}.bbclass`;
  const recipePath = `recipes-examples/classcraft/${target}_1.0.bb`;
  const guide = usage(c, target, directory);
  const files = {
    [classPath]: lines.join('\n') + '\n',
    [recipePath]: recipe(c),
    'conf/layer.conf': [
      'BBPATH .= ":${LAYERDIR}"',
      'BBFILES += "${LAYERDIR}/recipes-*/*/*.bb ${LAYERDIR}/recipes-*/*/*.bbappend"',
      'BBFILE_COLLECTIONS += "classcraft"',
      'BBFILE_PATTERN_classcraft = "^${LAYERDIR}/"',
      'BBFILE_PRIORITY_classcraft = "6"',
      'LAYERDEPENDS_classcraft = "core"',
      'LAYERSERIES_COMPAT_classcraft = "scarthgap"', '',
    ].join('\n'),
    'README.md': guide,
  };
  if (c.scope === 'recipe' && c.template === 'asset') {
    files[`recipes-examples/classcraft/files/${c.asset}`] = 'SPDX-License-Identifier: MIT\nHello from the Classcraft data asset example.\n';
  }
  return { errors: [], files, classPath, recipePath, target, guide, custom: c.scope === 'recipe' && c.template === 'custom' };
}

export function bundle(result) {
  if (result.errors.length || !result.files) throw new Error('Cannot archive invalid metadata.');
  return zipSync(Object.fromEntries(Object.entries(result.files).map(([path, text]) => [`meta-classcraft/${path}`, strToU8(text)])));
}
