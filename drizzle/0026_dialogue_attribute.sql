-- 對白歸屬：這句話是誰說的（Z132）。
--
-- 量過真正的正文：已寫 9 集 6,623 段，對白 2,657 段（40%），而規則判得出
-- 是誰說的是 0 段。沒有這個任務，多角色有聲書就是一個人從頭唸到尾。
--
-- `ADD VALUE IF NOT EXISTS` 讓這支可以重跑；枚舉值不能刪，所以加之前要確定
-- 名字是對的。
ALTER TYPE "ai_job_kind" ADD VALUE IF NOT EXISTS 'DIALOGUE_ATTRIBUTE';
