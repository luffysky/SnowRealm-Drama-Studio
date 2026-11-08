-- 把既有的有聲書標起來 (Z147)
--
-- 「這一集有沒有聲音」本來是靠 `kind = 'VOICE'` ＋ 有 `episode_id` 判斷的，而
-- 那三個條件**手上傳的檔案也全部符合**：集數素材頁（`EpisodeAssetBrowser`）
-- 的可上傳清單裡就有 VOICE，而它的上傳帶著 `episodeId`、origin 是 LIBRARY。
--
-- 所以在那一頁傳一段三秒的參考音，它就是這一集的「有聲書」——而查詢取的是
-- 最新的那一個，於是它會把真正的 TTS 成品**頂掉**：閱讀器的有聲分頁顯示三秒，
-- 下載鍵指向那一段參考音，小說工作台的「N 集做出有聲書」也把它算進去。
--
-- 修法是讓合成出來的那一筆**自己說自己是什麼**（`tts/job.ts` 寫
-- `generation_meta`），而不是在查詢裡再疊一個猜測條件。既有的兩筆沒有這個標
-- 記，所以在這裡補——來源是 `ai_jobs` 自己記的 `result.assetId`，不是靠檔名或
-- 標題猜。
--
-- 冪等：`where generation_meta is null` 加上 `where` 條件只挑得到那幾筆，重跑
-- 不會再動任何一列。

update "assets" a
   set "generation_meta" = jsonb_build_object(
         'source', 'NOVEL_TO_AUDIO',
         'kind', 'AUDIOBOOK',
         'jobId', j."id",
         'backfilled', true
       )
  from "ai_jobs" j
 where j."kind" = 'NOVEL_TO_AUDIO'
   and j."status" = 'SUCCEEDED'
   and j."result" ? 'assetId'
   and a."id" = (j."result" ->> 'assetId')::uuid
   and a."generation_meta" is null;
