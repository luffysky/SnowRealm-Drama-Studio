-- 智慧語意檢索的索引表。
--
-- 設計取捨（重要）：embedding 用 real[] 而不是 pgvector 的 vector 型別。
-- Neon 有 pgvector 0.8.6，但本機測試用的 embedded-postgres 沒有，
-- 一個 vector(1024) 欄位會讓 migration 在本機直接失敗，而讓兩個環境的
-- schema 長得不一樣是更糟的選擇。
--
-- 以這個專案的規模（120 集 × 約 10 段 + 世界觀與角色，數千列）
-- 逐列算餘弦距離是毫秒等級；pgvector 的 ANN 索引要到十萬列以上才有意義。
-- 真的長到那時候，把欄位換成 vector(1024) 並建 ivfflat 索引即可，
-- 查詢介面不用改。
--
-- 中文檢索用 pg_trgm 而不是 to_tsvector：Postgres 內建的全文檢索不會斷中文詞，
-- 「碼頭的訂單」整串會變成一個 token，等於沒有索引。trigram 對中文才有效。
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE TABLE "search_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  -- 來源類型：EPISODE / CHAPTER / SCENE / WORLD_ENTRY / WORLD_EVENT /
  -- CHARACTER / ASSET / TASK / PROJECT
  "kind" text NOT NULL,
  -- 來源列的 id。同一列可以切成多段，用 chunk_index 區分。
  "ref_id" uuid NOT NULL,
  "chunk_index" integer DEFAULT 0 NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  -- 給檢索結果顯示的前後文，不是完整內文。
  "snippet" text DEFAULT '' NOT NULL,
  -- 實際被 embed 的純文字。
  "content" text NOT NULL,
  -- 1024 維，對應 voyage-4 的預設輸出。沒有金鑰時為 NULL，
  -- 此時只走 trigram 比對。
  "embedding" real[],
  "embedding_model" text DEFAULT '' NOT NULL,
  -- 內容雜湊：沒變就不重新計算 embedding，省錢也省時間。
  "content_hash" text NOT NULL,
  "indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "search_documents_source_key" UNIQUE("kind","ref_id","chunk_index")
);--> statement-breakpoint

ALTER TABLE "search_documents" ADD CONSTRAINT "search_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "search_documents_project_idx" ON "search_documents" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "search_documents_trgm_idx" ON "search_documents" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_documents_title_trgm_idx" ON "search_documents" USING gin ("title" gin_trgm_ops);--> statement-breakpoint

-- 餘弦相似度。IMMUTABLE 讓它可以用在索引與查詢規劃裡；
-- 維度不同或任一向量為零向量時回 0，而不是讓查詢整個炸掉。
CREATE OR REPLACE FUNCTION cosine_similarity(a real[], b real[])
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  dot double precision := 0;
  norm_a double precision := 0;
  norm_b double precision := 0;
  i integer;
BEGIN
  IF array_length(a, 1) IS DISTINCT FROM array_length(b, 1) THEN
    RETURN 0;
  END IF;

  FOR i IN 1 .. array_length(a, 1) LOOP
    dot := dot + (a[i]::double precision * b[i]::double precision);
    norm_a := norm_a + (a[i]::double precision * a[i]::double precision);
    norm_b := norm_b + (b[i]::double precision * b[i]::double precision);
  END LOOP;

  IF norm_a = 0 OR norm_b = 0 THEN
    RETURN 0;
  END IF;

  RETURN dot / (sqrt(norm_a) * sqrt(norm_b));
END;
$$;
