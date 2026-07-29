-- 🔴 選項身分模型 v1 → v2 資料遷移(#105 / #109)
--
-- v2 於 field-type-registry 落地時只改了**寫入端**的正規化,既有列仍是
-- `{choices: ["甲","乙"], colors: {...}, optionParents: {...}}`。
-- 讀取端(設計器選項面板)假設 v2 → 對舊表單整個面板 crash。
-- 「新程式碼配舊資料」是 schema 變更最容易漏的一半,瀏覽器實走才抓到。
--
-- 轉換:choices 字串 → {id, name, color?},color 取自舊的 colors map;
-- optionParents 以名稱為 key,轉成父選項 id 陣列。
-- id 由 md5 前 8 碼生成 —— 需**穩定**(同名同 id),否則重跑會產生不同 id。

UPDATE field_def f
SET options = (
  SELECT jsonb_build_object('choices', jsonb_agg(c ORDER BY ord))
         || (CASE WHEN f.options ? 'parentField'
                  THEN jsonb_build_object('parentField', f.options -> 'parentField')
                  ELSE '{}'::jsonb END)
  FROM (
    SELECT ord,
           jsonb_strip_nulls(jsonb_build_object(
             'id', 'o' || substr(md5(name), 1, 8),
             'name', name,
             'color', f.options -> 'colors' ->> name,
             'parents', CASE
               WHEN f.options -> 'optionParents' ? name
               THEN (SELECT jsonb_agg('o' || substr(md5(p #>> '{}'), 1, 8))
                       FROM jsonb_array_elements(f.options -> 'optionParents' -> name) p)
               ELSE NULL END
           )) AS c
    FROM jsonb_array_elements_text(f.options -> 'choices') WITH ORDINALITY AS t(name, ord)
  ) AS built
)
WHERE f.cell_value_type IN ('singleSelect', 'multiSelect')
  AND jsonb_typeof(f.options -> 'choices') = 'array'
  -- 只轉還是字串陣列的(已是 v2 的第一個元素會是 object)
  AND jsonb_array_length(f.options -> 'choices') > 0
  AND jsonb_typeof(f.options -> 'choices' -> 0) = 'string';
