"""
scan-mods.py —— 精确解析 NeoForge 模组的元数据,判断哪些模组「服务端必须也有」

依据:NeoForge 的 displayTest 字段
  IGNORE_ALL_VERSION   -> 纯客户端,服务端没有它也允许连接
  IGNORE_SERVER_VERSION-> 服务端可以缺
  其他(默认 MATCH_VERSION)-> 客户端会拒绝连接「不是 NeoForge 的服务端」

用法: python scan-mods.py "<mods 目录>"
"""
import io
import sys
import zipfile
import tomllib
from pathlib import Path

mods_dir = Path(sys.argv[1])

NEEDS_SERVER = "需要服务端"
CLIENT_ONLY = "纯客户端"
UNKNOWN = "读不到元数据"

rows = []


def read_toml_from_zip(zf: zipfile.ZipFile):
    for name in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml"):
        try:
            with zf.open(name) as f:
                return tomllib.load(f), None
        except KeyError:
            continue
        except Exception as e:  # noqa: BLE001
            return None, str(e)
    return None, "no toml"


def mods_from_jar(path: Path):
    """返回 [(jar内名称, modId, displayTest, side依赖信息)]"""
    out = []
    try:
        with zipfile.ZipFile(path) as zf:
            data, err = read_toml_from_zip(zf)
            if data is not None:
                for m in data.get("mods", []):
                    out.append((path.name, m.get("modId", "?"), m.get("displayTest"), None))
                return out, None
            # 没找到 -> 看看是不是 jarjar 里嵌套的 jar
            nested = [n for n in zf.namelist() if n.lower().endswith(".jar")]
            for n in nested:
                try:
                    inner = zipfile.ZipFile(io.BytesIO(zf.read(n)))
                    d2, _ = read_toml_from_zip(inner)
                    if d2 is not None:
                        for m in d2.get("mods", []):
                            out.append((f"{path.name} -> {n}", m.get("modId", "?"), m.get("displayTest"), None))
                except Exception:  # noqa: BLE001
                    continue
            if out:
                return out, None
            return [], f"未找到 mods.toml (含 {len(nested)} 个嵌套 jar)"
    except Exception as e:  # noqa: BLE001
        return [], str(e)


for jar in sorted(mods_dir.glob("*.jar")):
    entries, err = mods_from_jar(jar)
    if not entries:
        rows.append({"jar": jar.name, "modId": "?", "displayTest": "-", "判定": UNKNOWN, "备注": err or ""})
        continue
    for _, mod_id, display_test, _ in entries:
        # 只看主模组条目,跳过 minecraft/neoforge 这类声明
        if mod_id in ("minecraft", "neoforge", "forge"):
            continue
        dt = display_test or "MATCH_VERSION(默认)"
        if display_test in ("IGNORE_ALL_VERSION", "IGNORE_SERVER_VERSION"):
            verdict = CLIENT_ONLY
        else:
            verdict = NEEDS_SERVER
        rows.append({"jar": jar.name, "modId": mod_id, "displayTest": dt, "判定": verdict, "备注": ""})

need = [r for r in rows if r["判定"] == NEEDS_SERVER]
client = [r for r in rows if r["判定"] == CLIENT_ONLY]
unknown = [r for r in rows if r["判定"] == UNKNOWN]

print(f"共扫描 {len(list(mods_dir.glob('*.jar')))} 个 jar,解析出 {len(rows)} 条模组记录\n")

print(f"===== {NEEDS_SERVER}(客户端会因为它们拒绝连接原版服,共 {len(need)}) =====")
for r in sorted(need, key=lambda x: x["modId"]):
    print(f"  {r['modId']:<28} displayTest={r['displayTest']:<24} {r['jar']}")

print(f"\n===== {CLIENT_ONLY}(可以保留,共 {len(client)}) =====")
for r in sorted(client, key=lambda x: x["modId"]):
    print(f"  {r['modId']:<28} {r['jar']}")

if unknown:
    print(f"\n===== {UNKNOWN}(共 {len(unknown)}) =====")
    for r in unknown:
        print(f"  {r['jar']:<60} {r['备注']}")
