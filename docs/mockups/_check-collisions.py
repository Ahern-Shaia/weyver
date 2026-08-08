#!/usr/bin/env python3
"""單檔多畫面 mockup 的 CSS 類別撞名檢查。

🔴 為什麼要有這個:weyver-v2.html 在四次不同的編輯裡撞名四次
   —— .mid / .rec / .cap / .views —— 每次都是「裸規則 .x{}」與
   「後代規則 .y .x{}」共用同一個類名,而後者沒有覆寫前者設的
   display / width,於是版面壞掉而 CSS 不報錯。

   我在檔內寫過兩次「短又通用的類名要加前綴」的註解,然後又犯了兩次。
   **規則寫了沒檢查就會漏,連寫規則的人自己也一樣**
   ([[pitfall-rule-without-check-always-drifts]])—— 所以這次寫檢查。

判準:同一個類名同時被「裸規則」與「後代規則」樣式化 → 高風險,列出來。
"""
import re, sys, collections

RISK_PROPS = ('display', 'width', 'height', 'position', 'flex-direction', 'grid-template')

# 🔴 刻意共用的**基底元件類** —— 後代規則是在覆寫它,不是撞名。
# 這份白名單就是「我宣告這些是共用基底」的地方;不在名單上的同名 = 兩個東西撞在一起。
# ⚠️ 加進來之前先問:它真的是同一個元件嗎?`.views` 一度看起來也像。
# `expr` = 公式 / 彙總徽章,用在子表表頭與欄位值格兩處(後代規則只調 margin)。
# `fd-sw` = 勾選列,用在驗證區與帶入框兩處(後代規則只調間距字級)。
# `insp` = 右側面板,主畫面與面板陳列區是同一個元件(後代規則只改尺寸)。
SHARED_BASE = {'btn', 'cbx', 'ty', 'chip', 'ic', 'expr', 'fd-sw', 'insp'}

def check(path: str) -> int:
    src = open(path, encoding='utf-8').read()
    css = ''.join(re.findall(r'<style>(.*?)</style>', src, re.S))
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

    bare, nested = collections.defaultdict(list), collections.defaultdict(list)
    for sel, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
        for one in sel.split(','):
            one = one.strip()
            if not one or one.startswith('@') or one.startswith('from') or one.startswith('to'):
                continue
            parts = one.split()
            last = parts[-1]
            m = re.match(r'^\.([a-zA-Z][\w-]*)', last)
            if not m:
                continue
            name = m.group(1)
            # 祖先帶偽類(`.prow:hover .pic`)= 同一元件的**狀態變體**,不是兩個東西撞名。
            # 撞名幾乎不會長成「某個祖先 hover 時才發生」,所以這類直接跳過,免得產生假陽性。
            if len(parts) > 1 and any(':' in p for p in parts[:-1]):
                continue
            (bare if len(parts) == 1 else nested)[name].append((one, body))

    bad = []
    for name in (set(bare) & set(nested)) - SHARED_BASE:
        props = set()
        for _, body in bare[name]:
            props |= {p.split(':')[0].strip() for p in body.split(';') if ':' in p}
        # 後代規則有覆寫的就不算風險 —— 真正會壞的是「裸規則設了、後代沒覆寫」
        overridden = set()
        for _, body in nested[name]:
            overridden |= {q.split(':')[0].strip() for q in body.split(';') if ':' in q}
        risky = sorted(p for p in props if p.startswith(RISK_PROPS) and p not in overridden)
        if risky:
            bad.append((name, risky, [s for s, _ in bare[name]], [s for s, _ in nested[name]]))

    if not bad:
        print(f'✅ {path}:無高風險類別撞名')
        return 0
    print(f'🔴 {path}:{len(bad)} 個高風險類別撞名')
    for name, risky, b, n in sorted(bad):
        print(f'\n  .{name}')
        print(f'    裸規則設了 {", ".join(risky)} —— 後代規則若沒覆寫就會被套上')
        print(f'    裸  : {"; ".join(b)}')
        print(f'    後代: {"; ".join(n[:4])}{" …" if len(n) > 4 else ""}')
    return 1

def check_script(path: str) -> int:
    """🔴 2026-08-08 同一天把 weyver-v3 弄成全白兩次,兩次都是這支能擋的:
       ① 刪死碼時砍過頭,連 `for(const n in B)B[n].onclick` 與 `go(...)` 一起帶走
       ② 修 ① 時在註解裡寫了**字面的 script 結束標籤** —— HTML 解析器不管它在不在
          JS 註解裡,看到就把 script 收掉,於是區塊註解沒收尾、整段語法錯誤。
       兩次我都只看了「console 沒有紅字」—— **沒有錯誤不等於畫面還在**。"""
    import subprocess
    import tempfile
    src = open(path, encoding='utf-8').read()
    blocks = re.findall(r'<script>(.*?)</script>', src, re.S)
    if not blocks:
        return 0
    js = '\n;\n'.join(blocks)
    # 註解裡的字面結束標籤 —— 上面 ② 的那個坑,node 看不到(HTML 已經先截斷了)
    if re.search(r'<\s*/\s*script', js, re.I):
        print(f'🔴 {path}:script 內含字面的結束標籤 —— HTML 會在那裡截斷,改寫成 <\\/script>')
        return 1
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js)
        tmp = f.name
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    if r.returncode != 0:
        print(f'🔴 {path}:script 語法錯誤\n{r.stderr.strip().splitlines()[0] if r.stderr else ""}')
        return 1
    # 畫面切換是這幾份 mockup 的命脈:綁定沒了 = 全白,而語法是對的
    if 'class="switch"' in src and not re.search(r'\bgo\(', js):
        print(f'🔴 {path}:有切換列卻找不到 go(…) —— 載入後不會有任何畫面')
        return 1
    print(f'✅ {path}:script 語法與畫面切換正常')
    return 0


if __name__ == '__main__':
    paths = sys.argv[1:] or ['weyver-v2.html']
    sys.exit(max(max(check(p), check_script(p)) for p in paths))
