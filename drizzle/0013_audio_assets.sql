-- 81–90 素材資產中心：音訊這一層。
--
-- 全部是新增，沒有一行會動到既有資料。
-- assets 保持原樣（object_key / version / root_asset_id 都不動），
-- 既有 30 處指向 assets.id 的參照也不動——這是 2026-11-04 的決策，
-- 把檔案拆成 asset_files 等於要改那 30 處，還會多出「asset 沒有檔案」的狀態。
--
-- 兩個軸刻意分開（決策 §一.6）：
--   asset_variant_kind  衍生檔案：縮圖、預覽、波形、轉檔 —— 同一段錄音的不同算法產物
--   audio_variant       剪輯版本：完整、伴奏、精簡、純人聲 —— 不同的錄音
-- 混在一起的話「波形」跟「伴奏」會變成同一種東西，
-- 而且會沒有辦法表達「伴奏的波形」。

CREATE TYPE "audio_variant" AS ENUM ('FULL', 'INSTRUMENTAL', 'SHORT', 'VOCAL');--> statement-breakpoint

CREATE TYPE "audio_category" AS ENUM (
  'OP', 'ED', 'BGM', 'INSERT', 'CHARACTER_SONG',
  'AMBIENCE', 'ACTION', 'FOLEY', 'TRANSITION', 'EFFECT',
  'DIALOGUE', 'NARRATION', 'OTHER'
);--> statement-breakpoint

CREATE TYPE "license_status" AS ENUM (
  'PENDING_REVIEW', 'APPROVED', 'RESTRICTED', 'EXPIRED', 'REJECTED'
);--> statement-breakpoint

CREATE TYPE "audio_review_status" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'ARCHIVED');--> statement-breakpoint

-- 可編輯的顯示名稱。預設空字串＝沿用 name（原始檔名），
-- 不預先複製一份進去：複製之後沒人改過名的素材就會停在舊檔名，
-- 而 name 仍然是下載時存檔用的名字。
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "title" text DEFAULT '' NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audio_metadata" (
  -- 一軌一列，掛在這一軌的「代表 asset」上。
  "asset_id" uuid PRIMARY KEY NOT NULL,
  "category" "audio_category" DEFAULT 'OTHER' NOT NULL,
  "genre_tags" text[] DEFAULT '{}' NOT NULL,
  "mood_tags" text[] DEFAULT '{}' NOT NULL,
  "language" text DEFAULT '' NOT NULL,
  "artist" text DEFAULT '' NOT NULL,
  -- 可為 NULL：不知道 BPM 不等於 0，存 0 會讓篩選拿到錯的數字。
  "bpm" integer,
  "musical_key" text DEFAULT '' NOT NULL,
  "source_platform" text DEFAULT '' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audio_metadata_asset_id_fk"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audio_metadata_category_idx" ON "audio_metadata" ("category");--> statement-breakpoint

-- (revision × variant) 的格子。兩個獨立的軸，一個欄位表達不了
-- 「第二版的伴奏」這個格子。
CREATE TABLE IF NOT EXISTS "audio_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- 這一軌的代表 asset（錨點），不一定是這一列的檔案。
  "asset_id" uuid NOT NULL,
  -- 這一格實際的檔案。原始上傳的那一列，這兩欄相同。
  "file_asset_id" uuid NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "variant" "audio_variant" DEFAULT 'FULL' NOT NULL,
  "review_status" "audio_review_status" DEFAULT 'DRAFT' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audio_revisions_cell_key" UNIQUE ("asset_id", "revision", "variant"),
  CONSTRAINT "audio_revisions_asset_id_fk"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade,
  CONSTRAINT "audio_revisions_file_asset_id_fk"
    FOREIGN KEY ("file_asset_id") REFERENCES "assets"("id") ON DELETE cascade,
  CONSTRAINT "audio_revisions_created_by_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audio_revisions_asset_idx" ON "audio_revisions" ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_revisions_file_idx" ON "audio_revisions" ("file_asset_id");--> statement-breakpoint

-- 授權。這是一張表而不是 assets.license 那個 text 欄位的原因：
-- 88 要問「這個授權到期會影響哪幾集」「90 天內有哪些要續約」
-- 「這首有沒有被授權做串流」——這些都不是一段文字答得出來的。
--
-- 預設 PENDING_REVIEW：上傳不等於已授權，沒有人確認過的列不可以顯示「已授權」。
CREATE TABLE IF NOT EXISTS "asset_licenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  -- 為 NULL 代表這份授權涵蓋整軌，而不是單一剪輯版本。
  "audio_revision_id" uuid,
  "status" "license_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
  "reference" text DEFAULT '' NOT NULL,
  "rights_holder" text DEFAULT '' NOT NULL,
  "source" text DEFAULT '' NOT NULL,
  "license_type" text DEFAULT '' NOT NULL,
  "allowed_uses" text[] DEFAULT '{}' NOT NULL,
  "territories" text[] DEFAULT '{}' NOT NULL,
  "restrictions" text[] DEFAULT '{}' NOT NULL,
  "valid_from" timestamp with time zone,
  -- NULL 代表沒有到期日，不是「不知道」。不知道就留在 PENDING_REVIEW。
  "valid_until" timestamp with time zone,
  -- AI 生成素材：生成當時的方案與條款證據。
  -- 訂閱方案不等於無條件取得著作權，所以這個主張必須自己帶證據。
  "ai_generated_at" timestamp with time zone,
  "ai_plan_snapshot" text DEFAULT '' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "reviewed_by_id" uuid,
  "reviewed_at" timestamp with time zone,
  "created_by_id" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_licenses_asset_id_fk"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade,
  CONSTRAINT "asset_licenses_audio_revision_id_fk"
    FOREIGN KEY ("audio_revision_id") REFERENCES "audio_revisions"("id") ON DELETE cascade,
  CONSTRAINT "asset_licenses_reviewed_by_id_fk"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "asset_licenses_created_by_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "asset_licenses_asset_idx" ON "asset_licenses" ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_licenses_status_idx" ON "asset_licenses" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_licenses_expiry_idx" ON "asset_licenses" ("valid_until");--> statement-breakpoint

-- 授權文件本身也是一個 asset，不另外存一套檔案。
CREATE TABLE IF NOT EXISTS "asset_license_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "license_id" uuid NOT NULL,
  "file_asset_id" uuid NOT NULL,
  "document_type" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_license_documents_license_id_fk"
    FOREIGN KEY ("license_id") REFERENCES "asset_licenses"("id") ON DELETE cascade,
  CONSTRAINT "asset_license_documents_file_asset_id_fk"
    FOREIGN KEY ("file_asset_id") REFERENCES "assets"("id") ON DELETE cascade
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "asset_license_documents_license_idx"
  ON "asset_license_documents" ("license_id");
