-- 模型指派：「沒指定」要表示得出來 (Z160)
--
-- `model_assignments.effort` 是 `not null default 'high'`，`max_tokens` 是
-- `not null default 32000`。而 `applyAssignment` 會把它們填進請求：
--
--     effort: input.effort ?? assignment.effort
--
-- 請求裡的值在 `resolveEffort` / `resolveMaxTokens` 的優先序裡排第一。所以
-- 只要在「AI 製片中心」指派過一次模型，那個任務就永遠是 high + 32000——
-- `TASK_EFFORT`、`TASK_MAX_TOKENS` 與系統設定那張表，三個又全部讀不到。
--
-- 這正是 Z157 修掉的那個 bug 從另一扇門走回來：一個資料庫預設值替任務做了
-- 決定，而「人沒有選」跟「人選了 high」在資料上長得一模一樣。
--
-- 改成可為 null。null 的意思是「這一列沒有特別指定」，讓後面的優先序回答。
-- 已經存在的列照 null 回填：那些值沒有一個是人挑的——UI 的儲存根本不送
-- maxTokens（schema 用 default 補 32000），effort 的草稿預設也是 'high'。

alter table "model_assignments" alter column "effort" drop not null;
alter table "model_assignments" alter column "effort" drop default;
alter table "model_assignments" alter column "max_tokens" drop not null;
alter table "model_assignments" alter column "max_tokens" drop default;

-- 回填：把等於舊預設值的那些視為「沒指定」。
-- 冪等：重跑只會把已經是 null 的再設成 null。
update "model_assignments" set "effort" = null where "effort" = 'high';
update "model_assignments" set "max_tokens" = null where "max_tokens" = 32000;

-- `candidates` 維持 not null default 1：1 是「就產一份」的意思，不是一個
-- 替人做的決定——而且 0 份候選沒有意義，所以它沒有「沒指定」這個狀態。
