-- 小說轉語音（Z129）。
--
-- 這個任務不走文字適配器——它呼叫的是 Azure TTS，而且是分次做完的：一集
-- 約三十分鐘的音檔，worker 的函式上限是 60 秒。所以它在 `executeJob` 裡
-- 走自己的分支，不經過 `resolveAdapter`。
ALTER TYPE "ai_job_kind" ADD VALUE IF NOT EXISTS 'NOVEL_TO_AUDIO';
