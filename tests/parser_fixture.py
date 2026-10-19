"""Isolated exact-version parser/function checks, not a configured Poky build."""
import json
from pathlib import Path
import sys
import tempfile

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

with tempfile.TemporaryDirectory(prefix="classcraft-parser-") as temp:
    temp = Path(temp)
    for case in manifest["cases"]:
        c = case["config"]
        assert c["template"] != "custom", "Custom code is never parsed or executed here"
        layer = root / ".fixtures" / case["directory"]
        work = temp / case["directory"]
        work.mkdir()
        # Minimal helper stubs isolate generated metadata from OE-Core. This does
        # not validate the real allarch/nopackages/base classes or a full build.
        helpers = work / "helpers" / "classes"
        helpers.mkdir(parents=True)
        for name in ("allarch", "nopackages", "fixture_helper"):
            (helpers / f"{name}.bbclass").write_text("# Parser fixture stub only\n")
        d = bb.data.init()
        values = {
            "BBPATH": f"{layer}:{work / 'helpers'}",
            "__bbclasstype": c["scope"],
            "PN": case["target"], "BPN": case["target"], "PV": "1.0",
            "MACHINE": "fixture-machine", "OVERRIDES": "class-target",
            "WORKDIR": str(work), "B": str(work / "build"),
            "D": str(work / "image"), "T": str(work / "temp"),
            "datadir": "/usr/share", "PATH": "/usr/bin:/bin",
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
        parsed = bb.parse.handle(str(layer / case["recipePath"]), d)[""]
        if c["scope"] == "global":
            assert parsed.getVar("FIXTURE_GLOBAL") == "yes"
            assert not parsed.getVar(case["task"])
            continue
        task = case["task"]
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
        if c["template"] == "asset":
            assert parsed.getVarFlag(task, "fakeroot") == "1"
            assert "virtual/fakeroot-native:do_populate_sysroot" in parsed.getVarFlag(task, "depends")
            asset = layer / "recipes-examples" / "classcraft" / "files" / c["asset"]
            (work / c["asset"]).write_bytes(asset.read_bytes())
            assert f"file://{c['asset']}" in parsed.getVar("SRC_URI")
            assert f"/usr/share/{case['target']}" in parsed.getVar(f"FILES:{case['target']}")
            if c["runtimeDepends"]:
                assert parsed.getVar(f"RDEPENDS:{case['target']}").strip() == c["runtimeDepends"]
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
        bb.build.exec_func(task, parsed)
        executed += 1
        if c["template"] == "asset":
            staged = work / "image" / "usr" / "share" / case["target"] / c["asset"]
            assert staged.read_bytes() == asset.read_bytes()
            assert staged.stat().st_mode & 0o777 == 0o644

print(f"PASS: {len(manifest['cases'])} exact BitBake {bb.__version__} parser fixtures; "
      f"{executed} fixed built-in function executions. No custom code or full Yocto build.")
