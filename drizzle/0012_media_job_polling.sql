-- 媒體生成任務的輪詢支援。
--
-- 影片生成要跑好幾分鐘，比 serverless function 的執行上限還長。
-- 所以任務送出之後要能先結束、之後再回來問結果：
--   external_job_id  供應商自己的任務代號
--   AWAITING_PROVIDER 已送出、等供應商
--
-- external_job_id 有值就代表「已經送出過了」，worker 看到就去輪詢而不是重送。
-- 同一支影片付兩次錢是這個欄位要擋的事。
ALTER TYPE "ai_job_status" ADD VALUE IF NOT EXISTS 'AWAITING_PROVIDER' AFTER 'RUNNING';--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN IF NOT EXISTS "external_job_id" text DEFAULT '' NOT NULL;
