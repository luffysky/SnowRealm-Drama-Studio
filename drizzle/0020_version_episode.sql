-- 分集大綱也要能進版本紀錄（Z100）。
--
-- version_target 本來有 DOCUMENT / SHOT / CHARACTER / WORLD_ENTRY，
-- 就是沒有 EPISODE——而分集大綱是助理最常提案要改的東西。
--
-- 沒有這個值的後果不是「少一個功能」，是套用提案時那一段大綱被覆蓋
-- 之後沒有任何還原的路。程式碼裡寫著「備份是套用的一部分」，
-- 而實際上只有章節真的備份了。
ALTER TYPE "version_target" ADD VALUE IF NOT EXISTS 'EPISODE';
