import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { defaults, templates, generate, validate, bundle, taskFor, RELEASE, isPackaged } from '../src/generator.js';

const build = (patch = {}) => generate({ ...defaults(), ...patch });
const text = (result) => result.files[result.classPath];
const variable = (patch = {}) => ({ name: 'MYCLASS_MESSAGE', operator: '?=', override: '', value: 'Hello ${PN}', ...patch });

test('release contract distinguishes tag object from commit', () => {
  assert.equal(RELEASE.bitbake, '2.8.1');
  assert.notEqual(RELEASE.commit, RELEASE.tagObject);
});

for (const [template, options] of Object.entries(templates)) {
  for (const language of isPackaged({ template }) ? ['shell'] : ['python', 'shell']) {
    test(`${template} / ${language}: coherent namespaced task and sample`, () => {
      const c = { ...defaults(), template, ...options, language };
      if (language === 'shell') c.body = 'bbnote "Trusted test"';
      const r = generate(c);
      assert.deepEqual(r.errors, []);
      const cls = text(r);
      assert.match(cls, new RegExp(`${taskFor(c)}\\(\\) \\{`));
      assert.ok(cls.includes(`after ${options.after} before ${options.before}`));
      assert.ok(!cls.includes('do_install:append'));
      assert.ok(!cls.includes('INSANE_SKIP'));
      assert.ok(r.files[r.recipePath].includes('inherit allarch'));
      assert.ok(r.guide.includes(`bitbake -c ${taskFor(c).slice(3)} ${r.target}`));
      assert.ok(r.guide.includes(`bitbake -e ${r.target}`));
      assert.ok(r.files['conf/layer.conf'].includes('LAYERSERIES_COMPAT_classcraft = "scarthgap"'));
      if (template === 'asset') {
        assert.ok(cls.includes('SRC_URI += " file://${RECIPE_AUDIT_ASSET}"'));
        assert.ok(cls.includes('FILES:${PN} += "${datadir}/${BPN}"'));
        assert.ok(cls.includes('"${D}${datadir}/${BPN}"'));
        assert.ok(cls.includes('fakeroot do_recipe_audit_install_asset()'));
        assert.ok(cls.includes('[depends] += "virtual/fakeroot-native:do_populate_sysroot"'));
        assert.ok(r.files['recipes-examples/classcraft/files/example.txt']);
        assert.ok(!r.files[r.recipePath].includes('nopackages'));
      } else if (!isPackaged(c)) {
        assert.ok(r.files[r.recipePath].includes('nopackages'));
        assert.equal(Object.keys(r.files).length, 4);
      }
    });
  }
}

for (const scope of ['recipe', 'global']) {
  for (const location of ['scoped', 'shared']) {
    test(`${scope} / ${location}: directory and inheritance contract`, () => {
      const r = build({ scope, location, variables: [variable()] });
      assert.ok(r.classPath.startsWith(location === 'scoped' ? `classes-${scope}/` : 'classes/'));
      if (scope === 'global') {
        assert.doesNotMatch(text(r), /addtask|python .*\(\)|^inherit /m);
        assert.ok(r.guide.includes('INHERIT += "recipe_audit"'));
        assert.ok(!r.files[r.recipePath].includes('inherit allarch nopackages recipe_audit'));
      }
    });
  }
}

for (const operator of ['=', '?=', '??=', ':=']) {
  test(`variable operator ${operator} and chained colon conditions`, () => {
    const r = build({ variables: [variable({ operator, override: 'class-native:qemux86-64' })] });
    assert.deepEqual(r.errors, []);
    assert.ok(text(r).includes(`MYCLASS_MESSAGE:class-native:qemux86-64 ${operator} "Hello \${PN}"`));
  });
}

test('values preserve single/double quotes, spaces, empty values and simple expansions', () => {
  for (const [value, output] of [['say "hello"', '\'say "hello"\''], ["it's fine", '"it\'s fine"'], ['', '""'], ['  ${PN}  ', '"  ${PN}  "']]) {
    const r = build({ variables: [variable({ value })] });
    assert.deepEqual(r.errors, []);
    assert.ok(text(r).includes(`MYCLASS_MESSAGE ?= ${output}`));
  }
});

test('all supported flags and dependency namespaces generated independently', () => {
  const r = build({
    inherits: 'pkgconfig gettext', buildDepends: 'zlib virtual/libgl',
    taskDepends: 'zlib-native:do_populate_sysroot', taskRdepends: 'some-package:do_packagedata',
    dirs: '${WORKDIR}/audit ${B}/logs', vardeps: 'MY_INPUT PN', nostamp: true,
  });
  assert.deepEqual(r.errors, []);
  for (const expected of [
    'inherit pkgconfig gettext', 'DEPENDS += "zlib virtual/libgl"',
    '[depends] += "zlib-native:do_populate_sysroot"',
    '[rdepends] += "some-package:do_packagedata"',
    '[dirs] += "${WORKDIR}/audit ${B}/logs"', '[vardeps] += "MY_INPUT PN"', '[nostamp] = "1"',
  ]) assert.ok(text(r).includes(expected), expected);
  assert.ok(!text(r).includes('RDEPENDS:'));
});

test('runtime metadata only for packaged asset template', () => {
  assert.ok(build({ runtimeDepends: 'zlib' }).errors.length);
  const r = build({ template: 'asset', language: 'shell', after: 'do_install', before: 'do_package do_populate_sysroot', runtimeDepends: 'zlib' });
  assert.deepEqual(r.errors, []);
  assert.ok(text(r).includes('RDEPENDS:${PN} += "zlib"'));
});

const badFields = {
  name: ['', 'base', 'allarch', 'nopackages', '../oops', 'bad-name', '1bad', 'evil\nX = "x"', 'x'.repeat(49), 'bad"name'],
  scope: ['config'], location: ['../classes'], template: ['unknown'], language: ['ruby'],
  inherits: ['recipe_audit', '../base', 'base\nX = "x"', '${EVIL}', '"base"'],
  buildDepends: ['zlib; echo bad', 'zlib\nfoo', 'zlib (>= 1)', '${@1}', 'bad_name'],
  runtimeDepends: ['zlib:do_build', 'zlib\nx', '"zlib"'],
  after: ['do_build', 'do_configure', 'do_recipe_audit_report', 'do_patch\nX', 'patch', 'do_patch;'],
  before: ['', 'do_patch', 'do_recipe_audit_report', 'build', 'do_configure\nX'],
  dirs: ['/tmp', '${WORKDIR}/../bad', '${WORKDIR}/a/..', '${HOME}', '${WORKDIR}/"bad"', '${B}\n/tmp', '${B}/.'],
  taskDepends: ['zlib', 'zlib:build', 'zlib:do_build\nx', '${PN}:do_build', 'zlib:do_build;'],
  taskRdepends: ['pkg', 'virtual/pkg:do_build', 'pkg:do_build\nX'],
  vardeps: ['lowercase', '${PN}', 'PN\nX', 'PN:append'],
  nostamp: ['1', 1],
};
for (const [field, values] of Object.entries(badFields)) {
  test(`reject invalid ${field} values without producing downloadable files`, () => {
    for (const value of values) {
      const r = build({ [field]: value });
      assert.ok(r.errors.length, `${field}: ${JSON.stringify(value)}`);
      assert.equal(r.files, null);
      assert.throws(() => bundle(r), /invalid/);
    }
  });
}

test('structured line injection and control characters rejected in every variable component', () => {
  for (const field of ['name', 'operation', 'operator', 'override', 'value']) {
    for (const value of ['\nX = "pwn"', '\r', '\t', '\0', '\u2028']) {
      assert.ok(build({ variables: [variable({ [field]: value })] }).errors.length, field);
    }
  }
});

test('variable metadata constraints are explicit, not lossy escaping', () => {
  for (const patch of [
    { value: '"both\' quotes' }, { value: 'trailing\\' }, { value: '${@__import__("os")}' }, { value: '${BAD:append}' },
    { value: '${nested${PN}}' }, { name: 'do_task' }, { name: 'SRC_URI' }, { name: 'WORKDIR' }, { name: 'INHERIT' },
    { name: 'RECIPE_AUDIT_ASSET' }, { override: 'append' }, { override: 'class-native:remove' },
    { override: 'Bad' }, { override: 'foo_bar' }, { override: 'foo::bar' }, { override: ' foo' },
  ]) assert.ok(build({ variables: [variable(patch)] }).errors.length, JSON.stringify(patch));
  assert.ok(build({ variables: [variable(), variable()] }).errors.length);
  assert.ok(build({ variables: Array.from({ length: 21 }, (_, i) => variable({ name: `ITEM_${i}` })) }).errors.length);
});

test('custom code is preserved, never executed or labeled safe', () => {
  const body = 'bb.note("custom")\nif True:\n    bb.note(d.getVar("PN"))\n\n# ${@not_executed_here()}';
  const r = build({ template: 'custom', body });
  assert.deepEqual(r.errors, []);
  assert.ok(text(r).includes(body.split('\n').map((line) => `    ${line}`).join('\n')));
  assert.ok(text(r).includes('not parsed or security-validated'));
  assert.equal(r.custom, true);
  for (const bad of ['', ' ', 'x\0y', 'x\ry', 'x'.repeat(32001)]) assert.ok(build({ template: 'custom', body: bad }).errors.length);
});

test('asset constraints preserve safe source and packaging contract', () => {
  const c = { template: 'asset', language: 'shell', after: 'do_install', before: 'do_package do_populate_sysroot' };
  for (const asset of ['../bad.txt', 'bad.txt\nfoo', 'bad"file.txt', '${PN}.txt', 'bad name.txt', 'foo.sh', '-bad.txt', 'foo..txt']) {
    assert.ok(build({ ...c, asset }).errors.length, asset);
  }
  assert.ok(build({ ...c, after: 'do_compile' }).errors.length);
  assert.ok(build({ ...c, before: 'do_build' }).errors.length);
  assert.ok(build({ ...c, language: 'python' }).errors.length);
});

test('multiple task edges and explicit no-after scheduling', () => {
  const r = build({ after: 'do_patch do_unpack', before: 'do_configure do_compile' });
  assert.deepEqual(r.errors, []);
  assert.ok(text(r).includes('after do_patch do_unpack before do_configure do_compile'));
  assert.deepEqual(build({ after: '' }).errors, []);
});

test('global ignores stored recipe options instead of accidentally emitting tasks', () => {
  const r = build({ scope: 'global', template: 'custom', body: 'evil()', inherits: 'pkgconfig', dirs: '/bad', nostamp: true });
  assert.deepEqual(r.errors, []);
  assert.doesNotMatch(text(r), /evil|pkgconfig|\/bad|nostamp|addtask/);
});

test('starter ZIP round-trips every file with safe fixed paths and no executable auto-start', () => {
  const r = build({ template: 'asset', language: 'shell', after: 'do_install', before: 'do_package do_populate_sysroot', asset: 'hello-world.txt' });
  const contents = unzipSync(bundle(r));
  assert.equal(Object.keys(contents).length, 5);
  for (const [path, value] of Object.entries(r.files)) {
    assert.ok(!path.includes('..') && !path.startsWith('/'));
    assert.equal(strFromU8(contents[`meta-classcraft/${path}`]), value);
  }
});

for (const language of ['shell', 'python']) {
  for (const hooks of ['none', 'pre', 'post', 'both']) {
    test(`${language} ${hooks} hooks use namespaced helpers and task varflags`, () => {
      const r = build({ language, hooks });
      assert.deepEqual(r.errors, []);
      for (const position of ['pre', 'post']) {
        const expected = hooks === 'both' || hooks === position;
        assert.equal(text(r).includes(`do_recipe_audit_report[${position}funcs] += "recipe_audit_${position}_hook"`), expected);
        if (expected) assert.ok(text(r).includes(`${language === 'python' ? 'python ' : ''}recipe_audit_${position}_hook() {`));
      }
    });
  }
  for (const template of ['report', 'preflight', 'custom']) {
    test(`${language} ${template} export has class-prefix implementation and callable recipe replacement`, () => {
      const c = { ...defaults(), template, language, exportFunctions: true };
      const r = generate(c);
      const task = taskFor(c);
      assert.deepEqual(r.errors, []);
      assert.ok(text(r).includes(`${c.name}_${task}() {`));
      assert.ok(text(r).includes(`EXPORT_FUNCTIONS ${task}`));
      assert.ok(text(r).includes(`addtask ${task.slice(3)}`));
      assert.ok(r.files[r.recipePath].includes(language === 'python'
        ? `bb.build.exec_func("${c.name}_${task}", d)` : `    ${c.name}_${task}`));
    });
  }
}

for (const mode of ['default', 'require', 'custom']) {
  test(`anonymous ${mode} emits an actual parse-time function and warning`, () => {
    const r = build({ anonymous: mode, anonymousValue: 'say "hello"' });
    assert.deepEqual(r.errors, []);
    assert.ok(text(r).includes('python () {'));
    if (mode === 'default') {
      assert.ok(text(r).includes('d.getVar("CLASSCRAFT_LABEL") is None'));
      assert.ok(text(r).includes('d.setVar("CLASSCRAFT_LABEL", "say \\"hello\\"")'));
    }
    if (mode === 'require') {
      assert.ok(text(r).includes('bb.fatal("CLASSCRAFT_LABEL'));
      assert.ok(r.files[r.recipePath].includes('CLASSCRAFT_LABEL = \'say "hello"\''));
    }
    if (mode === 'custom') {
      assert.equal(r.custom, true);
      assert.ok(text(r).includes('UNTRUSTED custom anonymous Python'));
    }
    assert.ok(r.guide.includes('including during -p/-e'));
  });
}

for (const variants of ['native', 'nativesdk', 'both']) {
  for (const template of ['report', 'preflight']) {
    test(`${template} ${variants} variants are recipe-local, not allarch`, () => {
      const r = build({ template, variants });
      assert.deepEqual(r.errors, []);
      assert.ok(!text(r).includes('BBCLASSEXTEND'));
      assert.ok(!r.files[r.recipePath].includes('allarch'));
      assert.ok(r.files[r.recipePath].includes(`BBCLASSEXTEND = "${variants === 'both' ? 'native nativesdk' : variants}"`));
      if (variants !== 'nativesdk') assert.ok(r.guide.includes('recipe-audit-example-native'));
      if (variants !== 'native') assert.ok(r.guide.includes('nativesdk-recipe-audit-example'));
    });
  }
}

for (const operation of ['append', 'prepend', 'remove']) {
  test(`conditional ${operation} uses colon operation and never silently adds spacing`, () => {
    const r = build({ variables: [
      variable({ value: 'base' }),
      variable({ operation, operator: '=', override: 'class-native', value: ' extra ' }),
    ] });
    assert.deepEqual(r.errors, []);
    assert.ok(text(r).includes(`MYCLASS_MESSAGE:${operation}:class-native = " extra "`));
    assert.ok(build({ variables: [variable({ operation, operator: '?=' })] }).errors.length);
  });
}

for (const template of ['asset', 'config', 'service']) {
  test(`${template} packaging has actual supplied input, fixed staging edges and no unsafe variants`, () => {
    const c = { ...defaults(), ...templates[template], template };
    const r = generate(c);
    assert.deepEqual(r.errors, []);
    assert.ok(text(r).includes(`fakeroot ${taskFor(c)}()`));
    assert.ok(text(r).includes('after do_install before do_package do_populate_sysroot'));
    assert.ok(!r.files[r.recipePath].includes('nopackages'));
    assert.equal(Object.keys(r.files).length, 5);
    assert.ok(generate({ ...c, variants: 'native' }).errors.length);
    assert.ok(generate({ ...c, exportFunctions: true }).errors.length);
    assert.ok(generate({ ...c, inherits: 'nopackages' }).errors.length);
    assert.ok(generate({ ...c, language: 'python' }).errors.length);
    if (template === 'config') {
      assert.ok(text(r).includes('CONFFILES:${PN} += "${sysconfdir}/${BPN}/example.conf"'));
      assert.ok(text(r).includes('FILES:${PN} += "${sysconfdir}/${BPN}/example.conf"'));
      assert.ok(text(r).includes('SRC_URI += " file://example.conf"'));
      assert.ok(text(r).includes('"${D}${sysconfdir}/${BPN}/example.conf"'));
      assert.ok(r.files['recipes-examples/classcraft/files/example.conf'].includes('message='));
    }
    if (template === 'service') {
      assert.ok(text(r).includes('inherit systemd features_check'));
      assert.ok(text(r).includes('REQUIRED_DISTRO_FEATURES += "systemd"'));
      assert.ok(text(r).includes('SYSTEMD_SERVICE:${PN} = "classcraft-demo.service"'));
      assert.ok(text(r).includes('SYSTEMD_AUTO_ENABLE:${PN} = "disable"'));
      assert.ok(text(r).includes('RDEPENDS:${PN} += "coreutils"'));
      assert.ok(text(r).includes('SRC_URI += " file://classcraft-demo.service.in"'));
      assert.ok(text(r).includes("sed -e 's|@BASE_BINDIR@|${base_bindir}|g'"));
      assert.ok(r.files['recipes-examples/classcraft/files/classcraft-demo.service.in'].includes('ExecStart=@BASE_BINDIR@/true'));
    }
  });
}

for (const template of ['asset', 'config']) {
  for (const mode of ['0600', '0644']) {
    test(`${template} install helpers preserve mode and coherent custom subdirectory`, () => {
      const r = build({ ...templates[template], template, installSubdir: 'company/demo', installMode: mode });
      assert.deepEqual(r.errors, []);
      assert.ok(text(r).includes(`install -m ${mode}`));
      assert.ok(text(r).includes('/company/demo'));
      assert.ok(!text(r).includes('/${BPN}'));
    });
  }
}

for (const serviceEnable of ['enable', 'disable', 'mask', 'preset']) {
  test(`service policy ${serviceEnable} is package scoped`, () => {
    const r = build({ ...templates.service, template: 'service', serviceEnable });
    assert.deepEqual(r.errors, []);
    assert.ok(text(r).includes(`SYSTEMD_AUTO_ENABLE:\${PN} = "${serviceEnable}"`));
  });
}

test('all new structured surfaces reject injection and incompatible choices', () => {
  for (const patch of [
    { hooks: 'pre\nX' }, { exportFunctions: 'yes' }, { anonymous: 'eval' },
    { anonymous: 'default', anonymousVariable: 'lower' },
    { anonymous: 'default', anonymousVariable: 'CONFFILES' },
    { anonymous: 'require', anonymousVariable: 'SYSTEMD_SERVICE' },
    { anonymous: 'default', anonymousValue: '${PN}' },
    { anonymous: 'default', anonymousValue: 'x\ny' },
    { anonymous: 'custom', anonymousBody: '' },
    { anonymous: 'custom', anonymousBody: 'x\r\ny' },
    { variants: 'native\nINHERIT' }, { variants: 'both', inherits: 'allarch' },
    { variants: 'native', template: 'custom' }, { inherits: 'native' },
    { inherits: 'nativesdk' }, { inherits: 'systemd' },
    { installSubdir: '../etc' }, { installSubdir: 'a/../b' },
    { installSubdir: '/etc' }, { installSubdir: '${D}' }, { installSubdir: 'a"b' },
    { installSubdir: 'a\nb' }, { installMode: '0777' }, { installMode: '0644\nX' },
    { serviceEnable: 'enable\nX' },
    { variables: [variable({ name: 'BBCLASSEXTEND' })] },
    { variables: [variable({ name: 'CONFFILES' })] },
    { variables: [variable({ operation: 'eval' })] },
  ]) assert.ok(build(patch).errors.length, JSON.stringify(patch));
  for (const file of ['../bad', 'bad name', 'bad\nX', '"quoted"', '${PN}']) {
    assert.ok(build({ ...templates.config, template: 'config', configFile: file }).errors.length);
    assert.ok(build({ ...templates.service, template: 'service', serviceFile: file }).errors.length);
  }
});

test('custom anonymous code is only inert downloadable text; global scope never emits it', () => {
  const anonymousBody = 'd.setVar("MARKER", "not executed")\n# arbitrary user-authored code';
  const r = build({ anonymous: 'custom', anonymousBody });
  assert.ok(text(r).includes(anonymousBody.split('\n').map((s) => `    ${s}`).join('\n')));
  assert.equal(r.custom, true);
  const global = build({ scope: 'global', anonymous: 'custom', anonymousBody, hooks: 'both', exportFunctions: true, variants: 'both', template: 'service' });
  assert.doesNotMatch(text(global), /python|EXPORT_FUNCTIONS|prefuncs|postfuncs|BBCLASSEXTEND|systemd/);
});
