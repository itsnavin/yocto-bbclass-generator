# Classcraft / Yocto bbclass generator

A static, guided generator for **Yocto 5.0.13 Scarthgap / BitBake 2.8.1**.
Everything happens in the browser: no accounts, network API, analytics, secrets,
remote fonts, or metadata execution. Inputs are kept in memory only; reloading
clears them. Generated code is not automatically saved or executed.

**Application:** https://itsnavin.github.io/yocto-bbclass-generator/

## What it generates

- Recipe-class templates: metadata report, required-value preflight, staged data
  asset installation, or an explicitly trusted custom shell/Python task.
- Recipe-scoped `classes-recipe/`, metadata-only global `classes-global/`, or
  shared `classes/` placement, with matching `inherit` / configuration `INHERIT`.
- Namespaced tasks; `addtask` before/after edges; `dirs`, `depends`, `rdepends`,
  `vardeps` and opt-in `nostamp`, each explained before selection.
- Multiple variable declarations with `=`, `?=`, `??=`, `:=`, simple `${VAR}`
  references and modern colon override conditions.
- Additional recipe inheritance, build-time `DEPENDS`, and packaged asset
  `RDEPENDS:${PN}`; task dependency namespaces are separately explained.
- Live text preview, accessible keyboard tabs, clipboard with explicit failure
  feedback, individual file downloads, and a ZIP starter layer containing
  `layer.conf`, `.bbclass`, a real sample `.bb`, any required source asset and
  exact installation/validation instructions.

The asset template installs a supplied MIT demo text file under
`${D}${datadir}/${BPN}`, extending `FILES:${PN}` after `do_install` and before
`do_package` and `do_populate_sysroot`. The task uses fakeroot with an explicit
`virtual/fakeroot-native:do_populate_sysroot` dependency for target ownership.
It neither replaces nor appends to `do_install`. Other built-in
examples are intentionally no-source and use `nopackages`. Sample recipes use
Poky's common MIT license; change the source/licensing/architecture for real work.

Reference-only guidance covers anonymous Python, prefuncs/postfuncs,
EXPORT_FUNCTIONS, BBCLASSEXTEND and signatures. These are **not generated
switches**. Global generation deliberately emits only variable declarations,
not recipe tasks or arbitrary inheritance. `cleandirs` is omitted because it
deletes directories; there are no host-cleanup templates, QA bypasses or blanket
installation hooks.

## Local development

Use Node.js 22.12+ or 24 LTS and npm. On Windows with PowerShell execution policy
restrictions, use `npm.cmd` / `npx.cmd` instead of changing execution policy.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

The UI uses vanilla JavaScript and CSS, Vite for local/build tooling and fflate
for browser ZIP output. All application assets are served locally. A production
deployment needs only the contents of `dist/`; no Node server is needed.

### Browser checks

```sh
npx playwright install chromium
npm run test:browser
```

To check the deployed site instead of starting a local server, set
`PLAYWRIGHT_BASE_URL=https://itsnavin.github.io/yocto-bbclass-generator/` in your
shell before `npm run test:browser`. In PowerShell use
`$env:PLAYWRIGHT_BASE_URL = "https://itsnavin.github.io/yocto-bbclass-generator/"`.
This exercises the actual live copy/download/ZIP interactions as well as the UI.

Desktop Chrome and emulated Pixel 7 checks exercise template selection,
structured errors, optional help, variable editing/removal, keyboard tabs,
global scope, inert custom code, clipboard success/failure, no external
application requests, horizontal layout and file/ZIP downloads. This is Chromium
coverage, not a claim of manual testing on physical mobile devices or all browsers.
On Windows hosts with AdGuard injection, its `local.adguard.org` requests are
annotated and excluded from the application-network assertion; the Linux CI
assertion has no such exclusion. The application itself loads no such scripts.

### Exact-release parser fixtures (Linux / WSL)

The fixture integration uses the BitBake source **from the exact Poky commit**
below, not a current BitBake install. In a Linux shell at this repository root:

```sh
mkdir -p .bitbake-source
curl --fail --location --silent --show-error \
  https://codeload.github.com/yoctoproject/poky/tar.gz/f16cffd030d21d12dd57bb95cfc310bda41f8a1f \
  -o .bitbake-source/poky.tar.gz
tar -xzf .bitbake-source/poky.tar.gz -C .bitbake-source \
  --strip-components=2 --wildcards '*/bitbake/*'
npm run fixtures
python3 tests/parser_fixture.py
```

On Windows generate fixtures with Node, then invoke Python through WSL from this
checkout, e.g. `wsl -d Ubuntu-24.04 --cd "$($PWD.Path)" -- python3 tests/parser_fixture.py`.
The upstream source and generated fixtures are ignored, never shipped to Pages.
Upstream BitBake retains its own license; it is not incorporated into application
bundles. This project links to official documentation rather than redistributing it.

Tests parse generated recipes/classes using BitBake's parser/datastore and
intentionally execute **only fixed harmless built-in function bodies** in a
disposable temporary directory. They check override expansion, assignments,
task edges/flags, failing preflight and installed file contents/mode. Minimal
allarch/nopackages/helper stubs isolate parser behavior; there is no OE-Core
configuration, runqueue, sysroot, package builder, or cross-toolchain in this
fixture. User custom code is excluded from both parser fixtures and execution.
**These checks are not a full Yocto recipe, image or toolchain build.**

## Trust and validation boundaries

Every class affects all inheriting recipes. Preview validity means only the
structured fields passed this generator's conservative constraints. Identifiers,
provider tokens, simple paths, overrides, line injection, quoting, duplicate
variables and obvious local ordering cycles are checked. Structured values
reject line breaks, control characters, backslashes, mixed quote styles and
non-simple `${...}` expansion. Rejected text is not silently stripped.
The generator reserves template contract variables and common build plumbing.
It does not emulate BitBake's datastore or guarantee a complete acyclic graph.

Custom task bodies are intentional executable metadata, **not sanitized code**.
They are displayed as inert text, not run, evaluated, compiled or declared safe.
Review and trust every inherited class and source before running BitBake;
anonymous Python can run at parse time even with `-p` or `-e`. A parser accepting
text says nothing about whether a task is safe or correct.

Within a configured Scarthgap Linux build environment, follow the generated
README: add the layer with `bitbake-layers add-layer`, check `show-layers` and
`show-recipes`, run `bitbake -p`, `bitbake -e <sample>`, `bitbake -c listtasks
<sample>` and `bitbake -g <sample>`, inspect final metadata/graphs, then
intentionally build the sample. Inspect `${T}/log.do_*` / `run.do_*` and staged
output. Stamps can skip unchanged tasks; `nostamp` also affects dependents.
Real sources, providers, licenses, active overrides, signatures and toolchain
results require checks in your actual build. No invented `-c check` is used.

## Version provenance and official references

The annotated `yocto-5.0.13` tag object
`529843b1c189ab7b133b7fdf197d4b2a4b71a6db` points to the actual **Poky commit**
`f16cffd030d21d12dd57bb95cfc310bda41f8a1f`. The tag object is not a commit.
That commit's `bitbake/lib/bb/__init__.py` reports **2.8.1**.

- [Yocto 5.0.13 layer/class structure](https://docs.yoctoproject.org/5.0.13/ref-manual/structure.html)
- [Release-matched BitBake 2.8 metadata manual](https://docs.yoctoproject.org/bitbake/2.8/bitbake-user-manual/bitbake-user-manual-metadata.html)
- [Pinned metadata manual source](https://github.com/yoctoproject/poky/blob/f16cffd030d21d12dd57bb95cfc310bda41f8a1f/bitbake/doc/bitbake-user-manual/bitbake-user-manual-metadata.rst)
- [Exact class lookup code](https://github.com/yoctoproject/poky/blob/f16cffd030d21d12dd57bb95cfc310bda41f8a1f/bitbake/lib/bb/parse/parse_py/BBHandler.py)
- [Configuration inheritance context](https://github.com/yoctoproject/poky/blob/f16cffd030d21d12dd57bb95cfc310bda41f8a1f/bitbake/lib/bb/cookerdata.py)
- [Debugging and build inspection](https://docs.yoctoproject.org/5.0.13/dev-manual/debugging.html)

In that source, inheritance searches `classes-<context>` across BBPATH first,
then `classes/`. Recipe context searches `classes-recipe`; configuration
inheritance uses `classes-global`. Scoped search takes precedence over shared
search, with BBPATH ordering within each. The user must provide referenced
classes/providers; selecting an additional inherit does not install it.

## Publishing and maintenance

The public repository is intentionally separate from other applications.
`.github/workflows/pages.yml` runs Node tests, exact-release parser fixtures,
desktop/mobile browser checks and a production build, then publishes `dist/`
through GitHub Pages on pushes to `main`. PRs validate but do not deploy.
Repository Settings → Pages must use **GitHub Actions** as its build source.
For project Pages paths, the build uses `--base=/yocto-bbclass-generator/`.
No deployment credentials are stored in source; the workflow uses scoped
GitHub Pages permissions and OIDC.

For a new Yocto version, deliberately update provenance, official references,
class-directory behavior, templates and fixture expectations together, then
run all checks in Linux and verify live downloads. Do not simply relabel the
release badge. Keep dependencies locked, audit upgrades, and use no external
scripts/telemetry. The generator does not promise compatibility with releases
other than the stated Scarthgap target.

MIT licensed. Independent project, not an official Yocto Project product.
