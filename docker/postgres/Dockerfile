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
# ## prod 對應
#
# Cloud SQL 需先設 flag `cloudsql.enable_pg_bigm` = on(會重啟實例),再 `CREATE EXTENSION`。
# migration 內的 `CREATE EXTENSION IF NOT EXISTS pg_bigm` 兩邊通用。

FROM postgres:16-alpine

# 版本固定 —— 不用 latest,升版須明示改此處
ARG PG_BIGM_VERSION=1.2-20240606

RUN set -eux; \
    apk add --no-cache --virtual .build-deps \
        build-base clang19 llvm19 postgresql16-dev curl tar; \
    cd /tmp; \
    curl -fsSL "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" -o pg_bigm.tar.gz; \
    tar xzf pg_bigm.tar.gz; \
    cd "pg_bigm-${PG_BIGM_VERSION}"; \
    make USE_PGXS=1; \
    make USE_PGXS=1 install; \
    cd /; \
    rm -rf /tmp/pg_bigm*; \
    apk del .build-deps; \
    # 建置期驗證:控制檔沒裝成功就讓 build 失敗,不要等到執行期才發現
    test -f /usr/local/share/postgresql/extension/pg_bigm.control
