#!/usr/bin/env bash
# 重新生成 PDF|從 docs/*.md → docs/pdf/*.pdf
#
# 前提:
#   - pandoc (brew install pandoc)
#   - Google Chrome (/Applications/Google Chrome.app)
#
# 使用:
#   cd /Users/ahern/Documents/work_work/weft
#   bash docs/pdf/build.sh
#
# 修改文件後執行本腳本更新 PDF。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(dirname "$SCRIPT_DIR")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# 欲轉檔清單(檔名不含 .md)
DOCS=(
  "04-完整產品功能表"
  "07-產品開發時程規劃"
  "08-MES-市場分析"
  "09-ERP-市場分析"
  "10-Ragic-完整功能分析"
  "11-技術棧規劃書"
  "12-TypeScript-7-與後端框架企業級評估"
  "13-產品開發功能順序表"
)

echo "==> Weyver docs → PDF"
echo "    source: $DOCS_DIR"
echo "    output: $SCRIPT_DIR"
echo ""

for name in "${DOCS[@]}"; do
  src="${DOCS_DIR}/${name}.md"
  html="${SCRIPT_DIR}/${name}.html"
  pdf="${SCRIPT_DIR}/${name}.pdf"

  if [ ! -f "$src" ]; then
    echo "  SKIP  ${name}.md (not found)"
    continue
  fi

  echo "  ${name}"

  # MD → HTML(標準 pandoc 管線,連 print.css)
  pandoc "$src" \
    -f markdown+pipe_tables+backtick_code_blocks \
    -t html5 \
    -s \
    --metadata title="${name}" \
    --css=print.css \
    -o "$html"

  # HTML → PDF(Chrome headless)
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=3000 \
    --print-to-pdf="$pdf" \
    "file://${html}" \
    2>/dev/null

  if [ -f "$pdf" ]; then
    size=$(du -h "$pdf" | cut -f1)
    echo "    → ${name}.pdf ($size)"
  else
    echo "    ERROR: PDF 生成失敗"
    exit 1
  fi
done

echo ""
echo "==> Done. 開啟預覽:"
echo "    open $SCRIPT_DIR/*.pdf"
