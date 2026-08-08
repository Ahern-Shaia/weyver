#!/usr/bin/env python3
"""把決策方 2026-08-08 的品牌重設計注入 weyver-v3.html。

邊界(決策方明示):**他們的稿不含頂部與底部** —— 所以 v3 保留 v2 的 `.top`(app nav),
只替換 `.top` 之後的內容。這是上次整包移植失敗後定下的做法:
**先講清楚部件邊界,再決定抽什麼**(docs/39 §5.0)。

⚠️ 三個必須做的轉換,少一個畫面就壞:
  1. root 的 `height:100vh` / `min-height:100vh` → `flex:1; min-height:0`
     —— 它們原本是整頁,現在被塞進 `.top` 之下,100vh 會溢出一個頂列的高度。
  2. 只取**設計 CSS**,丟掉 x-dc runtime(`.sc-placeholder` / 串流動畫 / print baseline)——
     那是鷹架不是設計。分界是 `x-dc{display:none!important}`。
  3. 設計 CSS 收進各自的 `#s-xxx` 底下,`body`/`*` 要改寫,否則會污染其他頁。
"""
import json
import re
import sys

RUNTIME_MARK = "x-dc{display:none!important}"
SELF_CLOSING = {"br", "img", "input", "hr", "path", "circle", "rect", "line",
                "polyline", "polygon", "ellipse", "use", "stop", "meta", "link"}


def load(path: str) -> dict:
    v = open(path, encoding="utf-8").read()
    for _ in range(3):
        v = json.loads(v)
        if isinstance(v, dict):
            return v
    raise SystemExit(f"{path}: 解不出 dict")


def top_level(html: str) -> list[str]:
    parts, depth, start = [], 0, None
    for m in re.finditer(r"<(/?)(\w[\w-]*)([^>]*?)(/?)>", html):
        close, tag, _, sc = m.groups()
        if tag.lower() in SELF_CLOSING:
            continue
        if close:
            depth -= 1
            if depth == 0 and start is not None:
                parts.append(html[start:m.end()])
                start = None
        elif not sc:
            if depth == 0:
                start = m.start()
            depth += 1
    return parts


def fix_root_style(style: str) -> str:
    """整頁 → 面板。100vh 在 `.top` 底下會多出一個頂列的高度。"""
    style = re.sub(r"(min-)?height:\s*100vh;?", "", style)
    return "flex:1;min-height:0;" + style.strip()


def design_css(css: str) -> str:
    return css.split(RUNTIME_MARK, 1)[1] if RUNTIME_MARK in css else ""


def scope(css: str, sel: str) -> str:
    out = []
    for m in re.finditer(r"(@[\w-]+[^{]*\{(?:[^{}]|\{[^{}]*\})*\})|([^{}]+)\{([^{}]*)\}", css, re.S):
        if m.group(1):
            out.append(m.group(1).strip())
            continue
        sels, body = m.group(2).strip(), m.group(3).strip()
        if not body:
            continue
        mapped = []
        for one in (x.strip() for x in sels.split(",")):
            if not one:
                continue
            if one in ("body", "html", ":root"):
                mapped.append(sel)
            elif one == "*":
                mapped.append(f"{sel} *")
            else:
                mapped.append(f"{sel} {one}")
        if mapped:
            out.append(f"{','.join(mapped)}{{{body}}}")
    return "\n".join(out)


def app_bounds(doc: str, sid: str) -> tuple[int, int]:
    """回傳該 `.app` 的內容起訖(整個 app div 的內側範圍)。"""
    # 登入頁的容器是 `.login` 不是 `.app` —— 用 id 找,不要假設 class
    m = re.search(rf'<div class="[\w-]+" id="{sid}"[^>]*>', doc)
    if not m:
        raise SystemExit(f"找不到 {sid}")
    depth, i = 1, m.end()
    for t in re.finditer(r"<(/?)div\b[^>]*?(/?)>", doc[m.end():]):
        if t.group(2):
            continue
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return m.end(), m.end() + t.start()
        i = t.end()
    raise SystemExit(f"{sid} 沒有收尾")


def top_block(doc: str, s: int, e: int) -> str:
    """取出 `.top`(要保留的頂部)。"""
    inner = doc[s:e]
    m = re.search(r'<div class="top">', inner)
    if not m:
        return ""
    depth, start = 1, m.start()
    for t in re.finditer(r"<(/?)div\b[^>]*?(/?)>", inner[m.end():]):
        if t.group(2):
            continue
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return inner[start:m.end() + t.end()]
    return ""


# ── 對映:v2 畫面 ← 他們的檔[取哪幾個直屬子層]。None = 全取 ──────────────
PLAN = [
    ("s-login",  "login",     None,   False),  # 登入頁沒有 app nav
    ("s-home",   "home",      [0, 2], True),
    ("s-blank",  "home",      [0, 1], True),   # [1] = 空工作區(原檔 display:none)
    ("s-form",   "workspace", None,   True),
    ("s-tpl",    "tpl",       None,   True),
    ("s-norows", "empty",     None,   True),
    ("s-design", "designer",  None,   True),
]

if __name__ == "__main__":
    doc = open("docs/mockups/weyver-v3.html", encoding="utf-8").read()
    css_add = []
    for sid, src, keep, keep_top in PLAN:
        d = load(f".playwright-mcp/x-{src}.html")
        parts = top_level(d["html"])
        chosen = parts if keep is None else [parts[i] for i in keep]
        if sid == "s-blank":
            chosen[1] = chosen[1].replace("display: none;", "display: block;", 1)
        s, e = app_bounds(doc, sid)
        top = top_block(doc, s, e) if keep_top else ""
        body = (f'\n  {top}\n  <div class="v3page" style="{fix_root_style(d["style"])}">\n'
                + "\n".join(chosen) + "\n  </div>\n")
        doc = doc[:s] + body + doc[e:]
        css_add.append(scope(design_css(d["css"]), f"#{sid}"))
        print(f"  {sid:9s} ← {src:9s} 取 {len(chosen)}/{len(parts)} 段, {len(''.join(chosen))} 字元")

    marker = "</style>"
    add = ("\n/* ══ 決策方 2026-08-08 品牌重設計:各頁的設計 CSS,收進自己的畫面 id ══\n"
           "   只取設計那段,x-dc runtime(.sc-placeholder / 串流動畫 / print baseline)已丟棄。 */\n"
           + "\n".join(css_add) + "\n")
    doc = doc.replace(marker, add + marker, 1)
    open("docs/mockups/weyver-v3.html", "w", encoding="utf-8").write(doc)
    print(f"\n✅ weyver-v3.html {len(doc)} 字元")
