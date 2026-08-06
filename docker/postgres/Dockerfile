# 🔴 R1·H-3 M1|dev PostgreSQL 需與 prod 一致地具備 pg_bigm。
#
# ## 為什麼要自建 image
#
# 繁中全文搜尋靠 `pg_bigm`(見 docs/modules/R1/full-text-search.md §0.1c 實測:
# 2 字查詢由全表掃描 ~50ms 降為索引 4.6ms)。prod 為 Cloud SQL,官方支援該擴充;
# 但 `postgres:16-alpine` **不含**它。
#
# 若 dev 沒有而 prod 有,查詢計畫會在兩邊不同 —— 本專案已多次栽在 dev/prod 分歧
# (見記憶 `pitfall_privileged_lane_masks_security`:特權連線遮蔽安全機制,同一 session 踩五次)。
#
# ## 為什麼不用第三方現成映像
#
# 供應鏈風險。自建的 Dockerfile 進版控、版本固定、可稽核(AGENTS.md 供應鏈鐵則)。
#
# ## 🔴 為什麼 `with_llvm=no`,以及為什麼不再列 clang / llvm(2026-08-06)
#
# **這個 Dockerfile 曾經是壞的,而本機建得起來只是因為吃到快取的 layer。**
# CI 上線第一天(乾淨環境)就炸出來:
#
#   ERROR: unable to select packages: clang19 (no such package) / llvm19 (no such package)
#
# 根因有兩層:
# 1. `FROM postgres:16-alpine` 是**浮動標籤**。底下的 alpine 換版之後,
#    `clang19` / `llvm19` 這兩個套件就不存在了 ——
#    而本檔上面逐字寫著「版本固定、可稽核」,那句話其實沒有兌現。
# 2. 拿掉版本號也不行:映像自己的 pgxs `Makefile.global` **寫死 `CLANG = clang-19`**
#    (postgres binary 當初是用 clang-19 編的),而 alpine 現在只給 clang16。
#    **是上游映像內部不一致**,不是我方寫錯版本號。
#
# 解法是**根本不要產 LLVM bitcode**:`with_llvm=no` 跳過 `.bc` 這一步。
# 代價是 pg_bigm 的函式沒有 JIT inlining —— 而 JIT inlining 的價值在
# 大量表達式求值,我方用 pg_bigm 的**整個目的正是靠 GIN 索引避開全表掃描**,
# 兩者不衝突。已實測:擴充載入正常,`show_bigm('測試')` 回
# `{" 測",測試,"試 "}`。
#
# ⚠️ 順帶記:`postgresql16-dev` **本來就會自己帶** clang/llvm(裝的是 16 那組),
# 明列 `clang19 llvm19` 從一開始就既多餘又脆。
#
# ## prod 對應
#
# Cloud SQL 需先設 flag `cloudsql.enable_pg_bigm` = on(會重啟實例),再 `CREATE EXTENSION`。
# migration 內的 `CREATE EXTENSION IF NOT EXISTS pg_bigm` 兩邊通用。

FROM postgres:16-alpine

# 版本固定 —— 不用 latest,升版須明示改此處
ARG PG_BIGM_VERSION=1.2-20240606

RUN set -eux; \
    apk add --no-cache --virtual .build-deps \
        build-base postgresql16-dev curl tar; \
    cd /tmp; \
    curl -fsSL "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" -o pg_bigm.tar.gz; \
    tar xzf pg_bigm.tar.gz; \
    cd "pg_bigm-${PG_BIGM_VERSION}"; \
    make USE_PGXS=1 with_llvm=no; \
    make USE_PGXS=1 with_llvm=no install; \
    cd /; \
    rm -rf /tmp/pg_bigm*; \
    apk del .build-deps; \
    # 建置期驗證:控制檔沒裝成功就讓 build 失敗,不要等到執行期才發現
    test -f /usr/local/share/postgresql/extension/pg_bigm.control
