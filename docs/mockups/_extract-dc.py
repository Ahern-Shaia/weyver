#!/usr/bin/env python3
"""把 x-dc 渲染後抽出的 JSON 轉成可注入 weyver-v3 的片段。

🔴 為什麼要有這支:x-dc 檔有 80–91 個 `{{ }}` 綁定,手工重打一定失真
   (2026-08-08 已為此退回過一次整包移植)。做法是在瀏覽器跑起來、抽渲染後的 DOM。

⚠️ 上次失敗的原因不是抽法錯,是**抽的邊界錯** —— 整棵樹抽下來連殼一起搬。
   這支只吐「內容」,殼(.top / .sbar)由 v3 自己提供。
"""
import json
import re
import sys


def load(path: str) -> dict:
    """Playwright 存下來的是被 JSON 包過一層的字串,可能包兩層。"""
    v = open(path, encoding="utf-8").read()
    for _ in range(3):
        v = json.loads(v)
        if isinstance(v, dict):
            return v
    raise SystemExit(f"{path}: 解不出 dict")


def children_of(html: str) -> list[str]:
    """列出頂層元素的開標籤(只掃第一層,用深度計數)。"""
    out, depth = [], 0
    for m in re.finditer(r"<(/?)(\w+)([^>]*?)(/?)>", html):
        close, tag, attrs, selfclose = m.groups()
        if tag.lower() in ("br", "img", "input", "path", "circle", "rect", "line", "polyline"):
            continue
        if close:
            depth -= 1
        elif not selfclose:
            if depth == 0:
                out.append(m.group()[:150])
            depth += 1
    return out


def scope_css(css: str, sel: str) -> str:
    """把 helmet 的全域 CSS 收進畫面容器底下,避免污染其他頁。"""
    css = re.sub(r"@import\s+(?:url\((?:[^()]|\([^()]*\))*\)|\"[^\"]*\"|'[^']*')\s*;\s*", "", css)
    out = []
    for m in re.finditer(r"(@[^{;]+\{(?:[^{}]|\{[^{}]*\})*\})|([^{}]+)\{([^{}]*)\}", css, re.S):
        if m.group(1):
            out.append(m.group(1))
            continue
        sels, body = m.group(2).strip(), m.group(3)
        mapped = []
        for one in sels.split(","):
            one = one.strip()
            if not one:
                continue
            if one in ("body", "html", ":root"):
                mapped.append(sel)
            elif one == "*":
                mapped.append(f"{sel} *")
            elif one.startswith("::"):
                mapped.append(f"{sel} {one}")
            else:
                mapped.append(f"{sel} {one}")
        out.append(f"{','.join(mapped)}{{{body}}}")
    return "\n".join(out)


if __name__ == "__main__":
    d = load(sys.argv[1])
    print(f"root: <{d['tag'].lower()}> class={d['cls']!r} 子層={d['children']}")
    print(f"style: {d['style'][:140]}")
    print(f"html {len(d['html'])} 字元 · css {len(d['css'])} 字元")
    print("\n直屬子層:")
    for i, c in enumerate(children_of(d["html"])):
        print(f"  [{i}] {c}")
