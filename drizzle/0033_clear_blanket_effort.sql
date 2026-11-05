-- 把既有任務身上那個不是人選的 'high' 清掉 (Z160)
--
-- Z157 修掉了「`enqueueJob` 把每個任務的 effort 都蓋成 high」這一行，但**已經
-- 存在的列還帶著它**。而 `requeueJob` 只改狀態與重試次數，`request` 一個字都
-- 不動——所以按「重試」會用完全相同的設定再跑一次。
--
-- 對那三筆失敗的「小說轉劇本」來說，那就是：再失敗一次，再收一次錢。
--
-- 為什麼可以斷定這些 'high' 不是人選的：介面從來不送 effort（`/api/ai/jobs`
-- 的呼叫端沒有一個帶這個欄位），而 probe 掃過佇列最近十筆，除了有聲書以外
-- 每一筆都是 'high'。也就是說資料庫裡**不存在**一個人工挑選的 effort。
--
-- 用 `-` 把 key 整個拿掉，不是設成 null：worker 讀的是
-- `request.effort ? {...} : {}`，兩者行為一樣，但拿掉才是「沒有這個欄位」的
-- 誠實表示。冪等：沒有這個 key 的列再跑一次還是沒有。

update "ai_jobs"
   set "request" = "request" - 'effort'
 where "request" ? 'effort'
   and "request" ->> 'effort' = 'high';

-- `maxTokens` 存的是 null（`input.maxTokens ?? null`），那本來就正確，不動。
