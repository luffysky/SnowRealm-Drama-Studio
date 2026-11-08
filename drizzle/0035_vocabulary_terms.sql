-- 可以自己加選項的下拉 (Z184)
--
-- ## 為什麼要有一張表，而不是直接往 enum 裡加
--
-- 景別與運鏡本來是 pg enum。enum 可以 `ALTER TYPE ... ADD VALUE`，但那條路
-- 有三個問題，而第三個是致命的：
--
--  1. 它不能在交易裡跑，所以一個「新增選項」的 API 沒辦法跟它要寫的那一列一
--     起成功或一起失敗。
--  2. 它要資料庫的 DDL 權限，而那不是一個「使用者按了按鈕」該拿到的權限。
--  3. **加進去的值刪不掉。** Postgres 沒有 `DROP VALUE`。打錯一個字就永遠留
--     在那裡，而唯一的清法是重建整個型別並改掉每一個用到它的欄位。
--
-- 所以欄位改成 text，合法值由應用程式把關（內建的那幾個 ∪ 這張表）。代價是
-- 資料庫不再替我們擋亂寫的值——換來的是這個功能能存在，以及打錯字可以刪掉。
--
-- ## 為什麼只有這兩個欄位
--
-- 這個 schema 有 39 個 enum，而其中一半是**程式在判斷的**：上傳狀態、任務狀
-- 態、AI 任務狀態、通話狀態。多一個值出來，製作流程的完成判定、看板分欄、篩
-- 選器會各自用各自的方式忽略它——而那不是「多一個選項」，是三個地方各壞一
-- 種壞法。
--
-- 景別與運鏡不一樣：它們純粹是**標籤**，沒有任何程式分支讀它們的值。
--
-- ## 工作室共用，不分作品
--
-- 沒有 `project_id`。這是一間兩個人、兩部作品的工作室，而「景別」是電影語
-- 言，不是某一部戲的設定。真的需要分作品再加那一欄——而那時候會知道為什麼
-- 需要，現在不會。

create table if not exists "vocabulary_terms" (
  "id" uuid primary key default gen_random_uuid(),
  -- 'shot_size' | 'camera_move'，對應 `VOCABULARY_KINDS`。
  "kind" text not null,
  -- 存進資料欄位的值。大寫英數底線，跟內建的那幾個同一種長相。
  "value" text not null,
  "label" text not null,
  "sort_order" integer not null default 0,
  "created_by_id" uuid references "users"("id") on delete set null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

-- 同一類裡不能有兩個一樣的值，否則下拉會出現兩個長得一樣的選項。
create unique index if not exists "vocabulary_terms_unique"
  on "vocabulary_terms" ("kind", "value");

create index if not exists "vocabulary_terms_kind_idx"
  on "vocabulary_terms" ("kind", "sort_order");

-- ---------------------------------------------------------------------------
-- 欄位從 enum 改成 text
--
-- `using ... ::text` 把既有的值原樣帶過去，所以沒有任何一列會變。預設值要先
-- 拿掉再設回來：預設值的型別是舊的 enum，不先拆掉改不了欄位型別。
--
-- 冪等：`information_schema` 查到已經是 text 就跳過整段。

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'shots' and column_name = 'shot_size' and data_type <> 'text'
  ) then
    alter table "shots" alter column "shot_size" drop default;
    alter table "shots" alter column "shot_size" type text using "shot_size"::text;
    alter table "shots" alter column "shot_size" set default 'MS';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_name = 'shots' and column_name = 'camera' and data_type <> 'text'
  ) then
    alter table "shots" alter column "camera" drop default;
    alter table "shots" alter column "camera" type text using "camera"::text;
    alter table "shots" alter column "camera" set default 'STATIC';
  end if;
end $$;

-- `shot_size` 與 `camera_move` 這兩個型別**不刪**。
--
-- 刪掉它們等於把「內建的那幾個是什麼」從資料庫裡抹掉，而那是這次改動唯一真
-- 的不可逆的一步。留著不花任何東西，而且萬一要改回去，型別還在。
