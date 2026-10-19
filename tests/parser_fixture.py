"""Isolated exact-version parser/function checks, not a configured Poky build."""
import json
from pathlib import Path
import sys
import tempfile
import tarfile
import shutil

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / ".bitbake-source" / "lib"))
import bb
import bb.build
import bb.data
import bb.parse
import bb.siggen

manifest = json.loads((root / ".fixtures" / "manifest.json").read_text())
assert bb.__version__ == manifest["release"]["bitbake"], bb.__version__
executed = 0
hooks_executed = 0
variants_parsed = 0
archive_prefix = f"poky-{manifest['release']['commit']}/meta/classes-recipe/"
with tarfile.open(root / ".bitbake-source" / "poky.tar.gz") as archive:
    upstream = {name: archive.extractfile(archive_prefix + name + ".bbclass").read().decode()
                for name in ("systemd", "features_check")}


def run_fixed_function_with_hooks(task, data):
    """Match build.py's pre/task/post invocation order; not its runqueue."""
    global executed, hooks_executed
    for helper in (data.getVarFlag(task, "prefuncs") or "").split():
        bb.build.exec_func(helper, data)
        hooks_executed += 1
    bb.build.exec_func(task, data)
    executed += 1
    for helper in (data.getVarFlag(task, "postfuncs") or "").split():
        bb.build.exec_func(helper, data)
        hooks_executed += 1

with tempfile.TemporaryDirectory(prefix="classcraft-parser-") as temp:
    temp = Path(temp)
    for case in manifest["cases"]:
        c = case["config"]
        assert c["template"] != "custom", "Custom code is never parsed or executed here"
        assert c["anonymous"] != "custom", "Custom anonymous code must never reach the parser"
        work = temp / case["directory"]
        work.mkdir()
        # BitBake 2.8 derives anonymous function identifiers from filenames and
        # does not support whitespace in build paths. Isolate Windows paths.
        layer = work / "layer"
        shutil.copytree(root / ".fixtures" / case["directory"], layer)
        # Minimal helper stubs isolate generated metadata from OE-Core. This does
        # not validate the real allarch/nopackages/base classes or a full build.
        helpers = work / "helpers" / "classes"
        helpers.mkdir(parents=True)
        for name in ("allarch", "nopackages", "fixture_helper"):
            (helpers / f"{name}.bbclass").write_text("# Parser fixture stub only\n")
        # Actual pinned service/feature classes, but do not execute package
        # callbacks or systemctl. Only their parser/feature guards are covered.
        for name, source in upstream.items():
            (helpers / f"{name}.bbclass").write_text(source)
        # These isolate BitBake's extension mechanism, NOT OE-Core's rewriting.
        for variant in ("native", "nativesdk"):
            pn = "${BPN}-native" if variant == "native" else "nativesdk-${BPN}"
            (helpers / f"{variant}.bbclass").write_text(
                f'OVERRIDES .= ":class-{variant}"\nPN = "{pn}"\n')
        d = bb.data.init()
        values = {
            "BBPATH": f"{layer}:{work / 'helpers'}",
            "__bbclasstype": c["scope"],
            "PN": case["target"], "BPN": case["target"], "PV": "1.0",
            "MACHINE": "fixture-machine", "OVERRIDES": "class-target",
            "WORKDIR": str(work), "B": str(work / "build"),
            "D": str(work / "image"), "T": str(work / "temp"),
            "datadir": "/usr/share", "PATH": "/usr/bin:/bin",
            "sysconfdir": "/etc", "bindir": "/usr/bin", "base_bindir": "/bin",
            "systemd_system_unitdir": "/lib/systemd/system",
            "DISTRO_FEATURES": "systemd", "PACKAGES": case["target"],
            "BB_HASH_CODEPARSER_VALS": "", "BB_SIGNATURE_HANDLER": "noop",
        }
        for key, value in values.items():
            d.setVar(key, value)
        # Shell logging helpers exist in the real base class. Supply harmless
        # equivalents here, without sourcing or executing any external recipe.
        for name, body in {"bbnote": 'printf "%s\\n" "$*"', "bbfatal": 'printf "%s\\n" "$*" >&2; exit 1'}.items():
            d.setVar(name, body)
            d.setVarFlag(name, "func", "1")
        bb.parse.siggen = bb.siggen.init(d)
        bb.parse.init_parser(d)
        if c["scope"] == "global":
            # Same global lookup context used by cookerdata, then recipe context.
            bb.parse.BBHandler.inherit(c["name"], "fixture.conf", 1, d)
            d.setVar("__bbclasstype", "recipe")
        if case["defaultRecipePath"]:
            default_data = bb.parse.handle(str(layer / case["defaultRecipePath"]), d.createCopy())[""]
            assert f"{c['name']}_{case['task']}" in default_data.getVar(case["task"])
            assert default_data.getVarFlag(case["task"], "python") == default_data.getVarFlag(f"{c['name']}_{case['task']}", "python")
            run_fixed_function_with_hooks(case["task"], default_data)
        parsed_variants = bb.parse.handle(str(layer / case["recipePath"]), d.createCopy())
        parsed = parsed_variants[""]
        if c["scope"] == "global":
            assert parsed.getVar("FIXTURE_GLOBAL") == "yes"
            assert not parsed.getVar(case["task"])
            continue
        task = case["task"]
        for key, value in parsed_variants.items():
            if key:
                variants_parsed += 1
                assert key in ("native", "nativesdk")
                expected_pn = f"{case['target']}-native" if key == "native" else f"nativesdk-{case['target']}"
                assert value.getVar("PN") == expected_pn
                assert all("allarch" not in path for path in (value.getVar("__inherit_cache") or []))
                expected_list = "base native" if key == "native" else "sdk base"
                assert " ".join(value.getVar("FIXTURE_LIST").split()) == expected_list
                run_fixed_function_with_hooks(task, value)
        if c["variants"] != "none":
            expected_keys = {"", "native", "nativesdk"} if c["variants"] == "both" else {"", c["variants"]}
            assert set(parsed_variants) == expected_keys
            assert parsed.getVar("FIXTURE_LIST").strip() == "base"
        if c["anonymous"] in ("default", "require"):
            assert parsed.getVar(c["anonymousVariable"]) == c["anonymousValue"]
            altered = d.createCopy()
            altered.setVar(c["anonymousVariable"], "")
            if c["anonymous"] == "default":
                assert bb.parse.handle(str(layer / case["recipePath"]), altered)[""].getVar(c["anonymousVariable"]) == ""
            else:
                # Omit the sample's assignment to prove the class requirement
                # fails during parse finalization, before any task execution.
                bare = work / "missing-required.bb"
                bare.write_text(f'inherit {c["name"]}\n')
                try:
                    bb.parse.handle(str(bare), altered)
                except bb.BBHandledException:
                    pass
                else:
                    raise AssertionError("Anonymous require must fail at parse time")
        assert parsed.getVarFlag(task, "task")
        for before in c["before"].split():
            assert task in parsed.getVarFlag(before, "deps")
        for after in c["after"].split():
            assert after in parsed.getVarFlag(task, "deps")
        if c["nostamp"]:
            assert parsed.getVarFlag(task, "nostamp") == "1"
            assert "zlib-native:do_populate_sysroot" in parsed.getVarFlag(task, "depends")
            assert "demo-package:do_packagedata" in parsed.getVarFlag(task, "rdepends")
            assert parsed.getVar("FIXTURE_ASSIGN") == case["target"]
            assert parsed.getVar("FIXTURE_DEFAULT") == "it's fine"
            assert parsed.getVar("FIXTURE_WEAK") == "weak"
            assert parsed.getVar("FIXTURE_IMMEDIATE") == "1.0"
            assert parsed.getVar("FIXTURE_OVERRIDE") == 'say "hello"'
        for position in ("pre", "post"):
            if c["hooks"] in (position, "both"):
                assert f"{c['name']}_{position}_hook" in parsed.getVarFlag(task, position + "funcs").split()
        if c["template"] in ("asset", "config", "service"):
            assert parsed.getVarFlag(task, "fakeroot") == "1"
            assert "virtual/fakeroot-native:do_populate_sysroot" in parsed.getVarFlag(task, "depends")
            filename = c["asset"] if c["template"] == "asset" else c["configFile"] if c["template"] == "config" else c["serviceFile"] + ".in"
            asset = layer / "recipes-examples" / "classcraft" / "files" / filename
            (work / filename).write_bytes(asset.read_bytes())
            assert f"file://{filename}" in parsed.getVar("SRC_URI")
            if c["runtimeDepends"]:
                assert c["runtimeDepends"] in parsed.getVar(f"RDEPENDS:{case['target']}").split()
        if c["template"] == "service":
            assert parsed.getVar(f"SYSTEMD_SERVICE:{case['target']}") == c["serviceFile"]
            assert parsed.getVar(f"SYSTEMD_AUTO_ENABLE:{case['target']}") == c["serviceEnable"]
            assert "systemd-systemctl-native" in parsed.getVar("DEPENDS").split()
            assert "coreutils" in parsed.getVar(f"RDEPENDS:{case['target']}").split()
            no_systemd = d.createCopy()
            no_systemd.setVar("DISTRO_FEATURES", "")
            skipped = bb.parse.handle(str(layer / case["recipePath"]), no_systemd)[""]
            assert "systemd" in skipped.getVar("__SKIPPED")
        if c["template"] == "preflight":
            key = f"{c['name'].upper()}_REQUIRED_VALUE"
            assert parsed.getVar(key) == "example-value"
            parsed.setVar(key, "")
            try:
                bb.build.exec_func(task, parsed)
            except bb.BBHandledException:
                pass
            except bb.process.ExecutionError as error:
                assert error.exitcode == 1
            else:
                raise AssertionError("Preflight must fail explicitly for empty metadata")
            parsed.setVar(key, "example-value")
        # Intentionally execute only these fixed harmless built-in function bodies
        # with all writes under the disposable temp directory, not a task runqueue.
        run_fixed_function_with_hooks(task, parsed)
        if c["template"] in ("asset", "config", "service"):
            subdir = c["installSubdir"] or case["target"]
            target_path = (f"/usr/share/{subdir}/{c['asset']}" if c["template"] == "asset" else
                           f"/etc/{subdir}/{c['configFile']}" if c["template"] == "config" else
                           f"/lib/systemd/system/{c['serviceFile']}")
            staged = work / "image" / target_path.lstrip("/")
            if c["template"] == "service":
                assert staged.read_text() == asset.read_text().replace("@BASE_BINDIR@", "/bin")
                assert "ExecStart=/bin/true" in staged.read_text()
                assert staged.stat().st_mode & 0o777 == 0o644
            else:
                assert staged.read_bytes() == asset.read_bytes()
                assert staged.stat().st_mode & 0o777 == int(c["installMode"], 8)
            included = parsed.getVar(f"FILES:{case['target']}")
            assert target_path in included or (c["template"] == "asset" and f"/usr/share/{subdir}" in included)
            if c["template"] == "config":
                assert parsed.getVar(f"CONFFILES:{case['target']}").strip() == target_path

print(f"PASS: {len(manifest['cases'])} exact BitBake {bb.__version__} parser fixtures; "
      f"{executed} fixed built-in function executions; {hooks_executed} hook calls; "
      f"{variants_parsed} stub-isolated variant datastores. No custom code or full Yocto build.")
