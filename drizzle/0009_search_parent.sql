-- 檢索結果要能直接開到正確的編輯器。
--
-- chapter 與 scene 都掛在 document 下，document 才掛在 episode。
-- 沒有這個欄位，搜到一段小說內文只能連到「小說列表」，使用者還要自己找是哪一集；
-- 有了它，結果可以直接連到 /projects/{p}/episodes/{e}/novel。
--
-- 可為 NULL：作品、世界觀、角色不屬於任何一集。
-- 不加外鍵：這是衍生索引，集數刪除時整列會被 reindex 清掉，
-- 不需要讓索引表反過來阻擋來源表的刪除。
ALTER TABLE "search_documents" ADD COLUMN IF NOT EXISTS "parent_ref_id" uuid;
