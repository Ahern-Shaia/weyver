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
SHARED_BASE = {'btn', 'cbx', 'ty', 'chip', 'ic'}

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
            last = one.split()[-1]
            m = re.match(r'^\.([a-zA-Z][\w-]*)', last)
            if not m:
                continue
            name = m.group(1)
            (bare if len(one.split()) == 1 else nested)[name].append((one, body))

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

if __name__ == '__main__':
    sys.exit(max(check(p) for p in (sys.argv[1:] or ['weyver-v2.html'])))
