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
  config: {
    description: 'Install a supplied configuration file under ${sysconfdir}/${BPN} and declare CONFFILES:${PN} for package-manager upgrade handling. Does not promise to preserve every edit with every package backend. Uses a separate fakeroot install task; no native/SDK variants.',
    after: 'do_install', before: 'do_package do_populate_sysroot', language: 'shell',
  },
  service: {
    description: 'Package a supplied systemd oneshot unit. Inherits systemd and features_check, requires systemd in DISTRO_FEATURES, and depends on coreutils for its real ${base_bindir}/true command. The unit template is installed with the configured base_bindir. Target-only; disabled by default.',
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
    hooks: 'none', exportFunctions: false,
    anonymous: 'none', anonymousVariable: 'CLASSCRAFT_LABEL', anonymousValue: 'ready',
    anonymousBody: 'd.setVar("CLASSCRAFT_LABEL", "ready")',
    variants: 'none', configFile: 'example.conf', serviceFile: 'classcraft-demo.service',
    serviceEnable: 'disable', installSubdir: '', installMode: '0644',
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
export const isPackaged = (c) => ['asset', 'config', 'service'].includes(c.template);
const reservedVariable = (name, c) =>
  /^(BBPATH|BBFILES|BBLAYERS|BBFILE_.+|LAYERSERIES_.+|INHERIT|OVERRIDES|BBCLASSEXTEND|SRC_URI|FILES|CONFFILES|SYSTEMD_.+|REQUIRED_DISTRO_FEATURES|DEPENDS|RDEPENDS|S|B|D|T|WORKDIR|PN|BPN|PV|LICENSE|LIC_FILES_CHKSUM)$/.test(name) ||
  ['ASSET', 'REQUIRED_VALUE'].some((suffix) => name === `${c.name.toUpperCase()}_${suffix}`);
const customBodyValid = (body) => typeof body === 'string' && body.trim() && !/[\x00\r]/.test(body) && body.length <= 32000;
const subdirectory = (c) => c.installSubdir || '${BPN}';

function metadataValue(value) {
  if (!oneLine(value) || /\\/.test(value) || (value.includes('"') && value.includes("'"))) return false;
  // Only simple, deferred datastore references in structured values, never inline Python.
  return !/\$\{/.test(value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''));
}

function quoted(value) {
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

export function validate(c) {
  c = { ...defaults(), ...c };
  const errors = [];
  const fail = (field, message) => errors.push({ field, message });
  if (!className.test(c.name) || ['base', 'allarch', 'nopackages', 'native', 'nativesdk', 'systemd', 'features_check'].includes(c.name)) {
    fail('name', 'Class name: use 1–48 lowercase letters/digits/underscores, starting with a letter; built-in class names are reserved here.');
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
      const operation = v.operation || 'set';
      if (!['set', 'append', 'prepend', 'remove'].includes(operation)) fail(`var-${i}-operation`, `${prefix}: unsupported override operation.`);
      if (!['=', '?=', '??=', ':='].includes(v.operator) || (operation !== 'set' && v.operator !== '=')) fail(`var-${i}-operator`, `${prefix}: override operations require =; defaults and immediate assignment apply only to set.`);
      if (!oneLine(v.override) || (v.override !== '' && !v.override.split(':').every((t) => /^[a-z0-9][a-z0-9-]*$/.test(t) && !['append', 'prepend', 'remove'].includes(t)))) {
        fail(`var-${i}-override`, `${prefix}: override conditions must be lowercase tokens separated by colons, not override operations.`);
      }
      if (!metadataValue(v.value)) fail(`var-${i}-value`, `${prefix}: use a single line without backslashes, mixed quotes, or non-simple \${...} expansions.`);
      const key = `${v.name}:${operation}:${v.override}`;
      if (seen.has(key)) fail(`var-${i}-name`, `${prefix}: duplicate declaration; use one declaration per variable/override combination.`);
      seen.add(key);
      if (reservedVariable(v.name, c)) {
        fail(`var-${i}-name`, `${prefix}: this generator reserves build plumbing and template contract variables. Use a class-specific variable instead.`);
      }
    });
  }
  if (c.scope !== 'recipe') return errors;
  if (!Object.hasOwn(templates, c.template)) fail('template', 'Choose a supported template.');
  if (!['shell', 'python'].includes(c.language)) fail('language', 'Choose shell or BitBake Python.');
  if (isPackaged(c) && c.language !== 'shell') fail('language', 'Installation templates require shell.');
  if (c.template === 'asset' && (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.txt$/.test(c.asset) || c.asset.length > 80)) {
    fail('asset', 'Asset: use a simple filename ending in .txt (letters, digits, underscores, hyphens), at most 80 characters.');
  }
  if (!['none', 'pre', 'post', 'both'].includes(c.hooks)) fail('hooks', 'Choose a supported task hook selection.');
  if (typeof c.exportFunctions !== 'boolean') fail('export-functions', 'EXPORT_FUNCTIONS must be a boolean.');
  if (c.exportFunctions && isPackaged(c)) fail('export-functions', 'Exported replacements are limited to non-installation tasks; install templates keep their fakeroot contract.');
  if (!['none', 'default', 'require', 'custom'].includes(c.anonymous)) fail('anonymous', 'Choose a supported anonymous Python operation.');
  if (['default', 'require'].includes(c.anonymous)) {
    if (!identifier.test(c.anonymousVariable) || reservedVariable(c.anonymousVariable, c)) fail('anonymous-variable', 'Anonymous operation: use a non-reserved uppercase variable identifier.');
    if (!metadataValue(c.anonymousValue) || c.anonymousValue.includes('${')) fail('anonymous-value', 'Anonymous literal: use single-line literal text without expansions, backslashes or mixed quotes.');
  }
  if (c.anonymous === 'custom' && !customBodyValid(c.anonymousBody)) fail('anonymous-body', 'Anonymous code must be nonempty, at most 32,000 characters, without NUL or carriage returns. It runs at parse time in BitBake; syntax is not checked here.');
  if (!['none', 'native', 'nativesdk', 'both'].includes(c.variants)) fail('variants', 'Choose native, nativesdk, both, or no variants.');
  if (c.variants !== 'none' && !['report', 'preflight'].includes(c.template)) fail('variants', 'Variants are limited to the no-source report/preflight examples. Installation and custom tasks require a manually designed variant contract.');
  if (c.template === 'config' && (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.conf$/.test(c.configFile) || c.configFile.length > 80)) fail('config-file', 'Configuration filename: a simple name ending in .conf, at most 80 characters.');
  if (c.template === 'service' && (!/^[a-z][a-z0-9_-]*\.service$/.test(c.serviceFile) || c.serviceFile.length > 80)) fail('service-file', 'Service filename: a simple lowercase name ending in .service, at most 80 characters.');
  if (!['enable', 'disable', 'mask', 'preset'].includes(c.serviceEnable)) fail('service-enable', 'Choose a supported systemd auto-enable policy.');
  if (!oneLine(c.installSubdir) || (c.installSubdir && !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(c.installSubdir))) fail('install-subdir', 'Install subdirectory: simple relative segments only, without traversal, expansions, whitespace or quotes. Empty uses ${BPN}.');
  if (!['0644', '0600'].includes(c.installMode)) fail('install-mode', 'Data/config mode must be 0644 or 0600.');
  const list = (field, value, regex, description) => {
    if (!oneLine(value) || !tokens(value).every((t) => regex.test(t))) fail(field, description);
  };
  list('inherits', c.inherits, /^[a-z][a-z0-9_-]*$/, 'Inheritance: space-separated lowercase class names only.');
  if (oneLine(c.inherits) && tokens(c.inherits).includes(c.name)) fail('inherits', 'A class cannot inherit itself.');
  if (oneLine(c.inherits)) {
    const classes = tokens(c.inherits);
    if (classes.some((name) => ['native', 'nativesdk', 'systemd', 'features_check'].includes(name))) fail('inherits', 'Use the managed variants/service template instead of inheriting native, nativesdk, systemd or features_check directly.');
    if (isPackaged(c) && classes.includes('nopackages')) fail('inherits', 'Installation templates must produce a package; nopackages conflicts with that contract.');
    if (c.variants !== 'none' && classes.includes('allarch')) fail('inherits', 'Variant examples must not inherit allarch.');
  }
  list('build-depends', c.buildDepends, provider, 'DEPENDS: space-separated recipe/provider names only, no versions or metadata expressions.');
  list('runtime-depends', c.runtimeDepends, /^[a-z0-9][a-z0-9+.-]*$/, 'RDEPENDS: space-separated package names only.');
  if (c.runtimeDepends && !isPackaged(c)) fail('runtime-depends', 'Runtime package metadata is available only for installation templates, which create a package.');
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
    if (isPackaged(c) && (c.after !== 'do_install' || c.before !== 'do_package do_populate_sysroot')) fail('after', 'Installation must stay after do_install and before do_package and do_populate_sysroot.');
  }
  list('dirs', c.dirs, /^\$\{(?:WORKDIR|B)\}(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/, 'dirs: use ${WORKDIR} or ${B} with simple subdirectories, without traversal.');
  if (oneLine(c.dirs) && tokens(c.dirs).some((p) => p.split('/').some((part) => ['.', '..'].includes(part)))) fail('dirs', 'dirs cannot contain traversal segments.');
  const edge = /^[a-z0-9][a-z0-9+.-]*(?:\/[a-z0-9][a-z0-9+.-]*)?:do_[a-z][a-z0-9_]*$/;
  list('task-depends', c.taskDepends, edge, 'depends: space-separated recipe:do_task pairs only.');
  list('task-rdepends', c.taskRdepends, /^[a-z0-9][a-z0-9+.-]*:do_[a-z][a-z0-9_]*$/, 'rdepends: space-separated package:do_task pairs only.');
  list('vardeps', c.vardeps, identifier, 'vardeps: space-separated uppercase variable identifiers only.');
  if (typeof c.nostamp !== 'boolean') fail('nostamp', 'nostamp must be a boolean.');
  if (c.template === 'custom' && !customBodyValid(c.body)) {
    fail('body', 'Custom code must be nonempty, at most 32,000 characters, without NUL or carriage returns. Syntax is not checked.');
  }
  return errors;
}

function functionBody(c) {
  const prefix = c.name.toUpperCase();
  if (c.template === 'custom') return c.body;
  if (c.template === 'asset') return [
    `install -d "\${D}\${datadir}/${subdirectory(c)}"`,
    `install -m ${c.installMode} "\${WORKDIR}/\${${prefix}_ASSET}" "\${D}\${datadir}/${subdirectory(c)}/\${${prefix}_ASSET}"`,
  ].join('\n');
  if (c.template === 'config') return [
    `install -d "\${D}\${sysconfdir}/${subdirectory(c)}"`,
    `install -m ${c.installMode} "\${WORKDIR}/${c.configFile}" "\${D}\${sysconfdir}/${subdirectory(c)}/${c.configFile}"`,
  ].join('\n');
  if (c.template === 'service') return [
    'install -d "${D}${systemd_system_unitdir}"',
    `sed -e 's|@BASE_BINDIR@|\${base_bindir}|g' "\${WORKDIR}/${c.serviceFile}.in" > "\${D}\${systemd_system_unitdir}/${c.serviceFile}"`,
    `chmod 0644 "\${D}\${systemd_system_unitdir}/${c.serviceFile}"`,
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
    `inherit ${c.scope === 'recipe' && c.variants !== 'none' ? '' : 'allarch '}${c.scope === 'recipe' && isPackaged(c) ? '' : 'nopackages '}${c.scope === 'recipe' ? c.name : ''}`.trimEnd(),
    '',
    'S = "${WORKDIR}"',
    'do_configure[noexec] = "1"',
    'do_compile[noexec] = "1"',
    'do_install[noexec] = "1"',
  ];
  if (c.scope === 'global') lines.push('', `# Enable via INHERIT += "${c.name}" in conf/local.conf, not inherit here.`, '# This no-source recipe is only a metadata inspection target.');
  else if (c.template === 'preflight') lines.push('', `${c.name.toUpperCase()}_REQUIRED_VALUE = "example-value"`);
  else if (!isPackaged(c)) lines.push('', '# No source is needed for this demonstration.', 'SRC_URI = ""');
  if (c.template === 'custom' && c.scope === 'recipe') lines.push('# Adapt sources, dependencies, architecture and disabled tasks for your custom code.');
  if (c.scope === 'recipe' && c.variants !== 'none') lines.push('', '# Variants belong to this example recipe, not to every inheritor of the class.', `BBCLASSEXTEND = "${c.variants === 'both' ? 'native nativesdk' : c.variants}"`);
  if (c.scope === 'recipe' && c.anonymous === 'require') lines.push('', '# Required at parse time; set before recipe finalization.', `${c.anonymousVariable} = ${quoted(c.anonymousValue || 'example-value')}`);
  if (c.scope === 'recipe' && c.exportFunctions) {
    const task = taskFor(c), implementation = `${c.name}_${task}`;
    lines.push('', '# A recipe replacement can still call the original exported class implementation.',
      `${c.language === 'python' ? 'python ' : ''}${task}() {`,
      c.language === 'python' ? `    bb.build.exec_func("${implementation}", d)` : `    ${implementation}`,
      '}');
  }
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

The built-in sample needs no real image target. Installation templates supply
their actual source files and add file:// to SRC_URI. Other examples intentionally
have no source and inherit nopackages. All samples disable configure/compile/install;
installation classes have their own task after do_install and before do_package
and do_populate_sysroot. Their fakeroot task explicitly depends on
virtual/fakeroot-native:do_populate_sysroot for target ownership.
${!global && c.template === 'asset' ? `Asset: files/${c.asset}, installed mode ${c.installMode} under \${D}\${datadir}/${subdirectory(c)}; FILES:\${PN} includes that directory.` : ''}
${!global && c.template === 'config' ? `Configuration: files/${c.configFile}, installed mode ${c.installMode} at \${D}\${sysconfdir}/${subdirectory(c)}/${c.configFile}. CONFFILES:\${PN} names the target path (without \${D}) for package-manager upgrade handling; inspect your backend's behavior.` : ''}
${!global && c.template === 'service' ? `Service: files/${c.serviceFile}.in is installed as \${systemd_system_unitdir}/${c.serviceFile}, substituting the configured base_bindir for @BASE_BINDIR@. Scarthgap coreutils installs true via alternatives under base_bindir (including usrmerge configurations); RDEPENDS:\${PN} adds coreutils. Requires systemd in DISTRO_FEATURES (features_check enforces it). SYSTEMD_SERVICE:\${PN} and SYSTEMD_AUTO_ENABLE:\${PN}="${c.serviceEnable}" are package scoped. "enable" can start/enable at package installation; "disable" does not enable; "mask" prevents activation; "preset" delegates to distribution preset policy. No daemon or init system is executed by the generator. Build the package and test boot/service behavior only in a suitable target image.` : ''}
The custom example is a scaffold: adapt its sources, architecture, disabled tasks
and dependencies for your code. Supplied demo text is MIT licensed. The recipe
uses Poky's common MIT license; replace LICENSE/LIC_FILES_CHKSUM for real sources.
Do not claim your own source is MIT without checking its license.

## Inspect results

Check the .env file for final assignments and active overrides. Confirm the task
in listtasks and inspect task-depends.dot from -g for expected edges and cycles.
After execution inspect \${T}/log.${global ? 'do_*' : task} and run.${global ? 'do_*' : task}
(including PID-suffixed files); find T with bitbake -e ${target}.
${isPackaged(c) && !global ? 'Inspect the staged files under ${D} and package contents/ownership. No packaging/boot success is implied by parser fixtures.\n' : ''}
Parsing alone is not a successful build. Graph generation is not task execution.
Build in a supported Linux environment configured for your MACHINE/DISTRO.
Use a workspace path without spaces; BitBake 2.8 anonymous function naming does
not support whitespace-containing build paths.

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

## Selected advanced generation

Task hooks: ${global ? 'not applicable in global scope' : c.hooks}. Generated
namespaced logging helpers are attached with += to this task's prefuncs/postfuncs.
They execute in the task context, not as independently scheduled tasks. Python
uses d and bb.note; shell uses bbnote. Failures propagate through the task.

EXPORT_FUNCTIONS: ${!global && c.exportFunctions ? 'enabled' : 'off'}.
When enabled, the implementation is ${c.name}_${task}; EXPORT_FUNCTIONS ${task}
provides the default wrapper. The sample recipe replaces ${task} and calls the
original implementation with ${c.language === 'python' ? 'bb.build.exec_func(..., d)' : 'its shell function name'}.
Task flags and addtask stay on the public namespaced task. No standard install
task is replaced. Install templates cannot enable exported replacements here.

Anonymous Python: ${global ? 'not emitted' : c.anonymous}. Runs at recipe parse
finalization, including during -p/-e. Guided default sets a literal only if
d.getVar(name) is None; guided require uses bb.fatal for a missing/empty value,
and the sample recipe supplies it. User-authored anonymous code is unparsed
executable metadata, NEVER executed or certified safe by this application/CI.
It can have arbitrary side effects when YOU later run BitBake.

Recipe variants: ${global ? 'none' : c.variants}. BBCLASSEXTEND is emitted on the
example recipe only, never the reusable class. Report/preflight no-source
examples omit allarch when variants are selected. native runs on the build host;
nativesdk targets the SDK host, not the target machine. Actual rewriting of
dependencies, paths and task behavior belongs to OE-Core's native/nativesdk
classes and must be verified in a configured build. Installation/custom templates
cannot select variants. Additional arbitrary inherits can change this contract.
${!global && c.variants !== 'none' ? `After building/inspecting the base recipe, repeat -e, -c listtasks, -g and a build for:\n${['native', 'nativesdk'].filter((variant) => c.variants === 'both' || c.variants === variant).map((variant) => variant === 'native' ? `${target}-native` : `nativesdk-${target}`).join('\n')}` : ''}

Variable override operations: set uses its chosen assignment operator; append,
prepend and remove use modern :operation[:condition] = syntax. Append/prepend
do NOT insert spaces: include the separator in the value. At expansion BitBake
applies append, then prepend, then remove, independent of textual assignment
order. Only active condition tokens apply; this browser does not emulate them.

## Additional guidance

Keep anonymous datastore operations deterministic and avoid I/O.
BBCLASSEXTEND creates variants only if sources, dependencies and packaging support
them; generated no-source demos are not a universal variant compatibility claim.
cleandirs deletes/recreates paths; deliberately not exposed by this generator.
Respect cross-compilation variables CC/CFLAGS/LDFLAGS; never invoke host gcc.

## Official references

https://docs.yoctoproject.org/5.0.13/ref-manual/structure.html
https://docs.yoctoproject.org/5.0.13/dev-manual/debugging.html
https://docs.yoctoproject.org/bitbake/2.8/bitbake-user-manual/bitbake-user-manual-metadata.html
https://github.com/yoctoproject/poky/blob/${RELEASE.commit}/bitbake/lib/bb/parse/parse_py/BBHandler.py
https://github.com/yoctoproject/poky/blob/${RELEASE.commit}/bitbake/lib/bb/parse/ast.py
https://github.com/yoctoproject/poky/blob/${RELEASE.commit}/meta/classes-recipe/systemd.bbclass
https://github.com/yoctoproject/poky/blob/${RELEASE.commit}/meta/recipes-core/coreutils/coreutils_9.4.bb
https://docs.yoctoproject.org/5.0.13/ref-manual/variables.html#term-CONFFILES
`;
}

export function generate(c) {
  c = { ...defaults(), ...c };
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
    const inherited = [...(c.template === 'service' ? ['systemd', 'features_check'] : []), ...tokens(c.inherits)];
    if (inherited.length) lines.push(`inherit ${inherited.join(' ')}`, '');
    if (c.template === 'preflight') lines.push(`${prefix}_REQUIRED_VALUE ?= ""`, '');
    if (c.template === 'asset') lines.push(
      `${prefix}_ASSET ?= "${c.asset}"`,
      `SRC_URI += " file://\${${prefix}_ASSET}"`,
      `FILES:\${PN} += "\${datadir}/${subdirectory(c)}"`, '',
    );
    if (c.template === 'config') lines.push(
      `SRC_URI += " file://${c.configFile}"`,
      `FILES:\${PN} += "\${sysconfdir}/${subdirectory(c)}/${c.configFile}"`,
      `CONFFILES:\${PN} += "\${sysconfdir}/${subdirectory(c)}/${c.configFile}"`, '',
    );
    if (c.template === 'service') lines.push(
      'REQUIRED_DISTRO_FEATURES += "systemd"',
      `SRC_URI += " file://${c.serviceFile}.in"`,
      `SYSTEMD_SERVICE:\${PN} = "${c.serviceFile}"`,
      `SYSTEMD_AUTO_ENABLE:\${PN} = "${c.serviceEnable}"`,
      `FILES:\${PN} += "\${systemd_system_unitdir}/${c.serviceFile}"`,
      'RDEPENDS:${PN} += "coreutils"', '',
    );
  }
  c.variables.forEach((v) => lines.push(`${v.name}${v.operation && v.operation !== 'set' ? `:${v.operation}` : ''}${v.override ? `:${v.override}` : ''} ${v.operator} ${quoted(v.value)}`));
  if (c.variables.length) lines.push('');
  if (c.scope === 'recipe') {
    if (c.buildDepends.trim()) lines.push(`DEPENDS += "${tokens(c.buildDepends).join(' ')}"`, '');
    if (c.runtimeDepends.trim()) lines.push(`RDEPENDS:\${PN} += "${tokens(c.runtimeDepends).join(' ')}"`, '');
    const task = taskFor(c);
    if (c.anonymous !== 'none') {
      let body = c.anonymousBody;
      if (c.anonymous === 'default') body = `if d.getVar("${c.anonymousVariable}") is None:\n    d.setVar("${c.anonymousVariable}", ${JSON.stringify(c.anonymousValue)})`;
      if (c.anonymous === 'require') body = `if not d.getVar("${c.anonymousVariable}"):\n    bb.fatal("${c.anonymousVariable} must be set before parse finalization")`;
      if (c.anonymous === 'custom') lines.push('# UNTRUSTED custom anonymous Python: runs during BitBake parsing, not checked here.');
      lines.push('python () {', ...body.split('\n').map((line) => `    ${line}`), '}', '');
    }
    if (c.hooks !== 'none') {
      for (const position of ['pre', 'post']) {
        if (c.hooks !== 'both' && c.hooks !== position) continue;
        const helper = `${c.name}_${position}_hook`;
        lines.push(`${c.language === 'python' ? 'python ' : ''}${helper}() {`,
          c.language === 'python' ? `    bb.note("${position} hook for " + d.getVar("PN"))` : `    bbnote "${position} hook for \${PN}"`,
          '}', `${task}[${position}funcs] += "${helper}"`, '');
      }
    }
    if (c.template === 'custom') lines.push('# Trusted custom code: not parsed or security-validated by the generator.');
    lines.push(`${isPackaged(c) ? 'fakeroot ' : ''}${c.language === 'python' ? 'python ' : ''}${c.exportFunctions ? `${c.name}_${task}` : task}() {`);
    lines.push(...functionBody(c).split('\n').map((line) => `    ${line}`), '}');
    if (c.exportFunctions) lines.push(`EXPORT_FUNCTIONS ${task}`);
    if (isPackaged(c)) lines.push(`${task}[depends] += "virtual/fakeroot-native:do_populate_sysroot"`);
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
  if (c.scope === 'recipe' && c.template === 'config') files[`recipes-examples/classcraft/files/${c.configFile}`] = '# SPDX-License-Identifier: MIT\n# Example application configuration; no credentials.\nmessage=Hello from Classcraft\n';
  if (c.scope === 'recipe' && c.template === 'service') files[`recipes-examples/classcraft/files/${c.serviceFile}.in`] = '# SPDX-License-Identifier: MIT\n[Unit]\nDescription=Classcraft harmless oneshot demonstration\n\n[Service]\nType=oneshot\nExecStart=@BASE_BINDIR@/true\nRemainAfterExit=yes\n\n[Install]\nWantedBy=multi-user.target\n';
  return { errors: [], files, classPath, recipePath, target, guide, custom: c.scope === 'recipe' && (c.template === 'custom' || c.anonymous === 'custom') };
}

export function bundle(result) {
  if (result.errors.length || !result.files) throw new Error('Cannot archive invalid metadata.');
  return zipSync(Object.fromEntries(Object.entries(result.files).map(([path, text]) => [`meta-classcraft/${path}`, strToU8(text)])));
}
