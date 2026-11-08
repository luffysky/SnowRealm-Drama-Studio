# 待辦清單｜2026-11-09（收工）

> 編號、狀態、統計一律以 `docs/todo/TODO.md` 為準。這一張只講「下一輪動哪幾
> 條」。
>
> 收工時狀態：**Z0–Z197，198 條**，連續無缺號無重複。里程碑總覽算的是
> **153 完成 / 193**——差的五條是指向別條的轉址（Z34／Z42／Z43／Z45／Z46），
> 不掛里程碑徽章，不然會重複計算。
>
> 十支檢查與 `next build` 全綠，`vitest` **1,017 個測試、62 個檔案**全過。
>
> 上一張：`docs/todo/todo_list_1106.md`。今天的過程寫在
> `docs/worklog/daily_works_1109.md`。

---

## 先講一件事：這一輪的東西大多不在 TODO.md 上

今天派了三個子代理做全專案普查（API 對資料庫、頁面對資料、RWD 與 PWA）。修掉
的那些記成 Z196／Z197，**沒修的那些還沒有編號**——它們列在下面第 2 區。

要動它們之前先編號進 `TODO.md`，不然 `check:todo` 的連續性檢查會對不上，而且
下一個上下文看不到這張清單。

---

## 0. 等你一句話（我動不了）

| | 項目 | 要你做什麼 | 成本 |
| --- | --- | --- | --- |
| **Z51** | 朝代名稱與 120 集正典 | **決定朝代名＋120 集怎麼分部** | — |
| **Z53** | 14/15/16 素材管理是否被 81–90 取代 | **確認**（答案可能是直接刪掉三條） | — |
| **Z81** | 視覺與設計稿的對齊落差 | **給圖**（集數縮圖那一批） | — |
| **Z145** | 波形不是你要的那種 | **截圖給我看** | — |
| **Z141** | EP002 以後都還沒跑對白歸屬 | 說要跑幾集 | 約 $0.13 / 集 |
| **Z142** | 已產出的兩個有聲書是舊的 | 說要不要重產 | 約 $0.05 / 集 |
| **Z143** | 有聲書沒有波形 | 先回 Z145，不然會做錯 | — |
| **七支 AI 廠商金鑰** | 照 `docs/API_KEYS.md` | 文字模型的七家適配器已經接好在等 | — |

**Z51 我不會替你編。** 朝代名會進 120 集的每一集、進世界觀條目、進 AI 的每一次
呼叫；猜一個然後全書跟著它長，比空著糟。

---

## 1. 建議的下一輪（照這個順序）

### 1-1　`drizzle/meta/_journal.json` 只記到 0015　**先修這條**

0016–0036 這**二十一支**遷移不在 journal 裡。意思是誰在新環境跑
`npm run db:migrate`，會拿到一個少二十一支遷移的資料庫**而且不會報錯**。

正式庫沒事（57 張表、719 個欄位逐欄比對都對得上），因為實務上大家走
`db:push`。但這是一顆定時炸彈，而且修法很便宜：**讓 `db:migrate` 在 journal
蓋不滿 `drizzle/*.sql` 的時候直接拒跑**，並在 `docs/ENVIRONMENT.md` 寫清楚新
環境的建法是 `db:reset` + `db:push`。

> 不要直接把二十一筆補進 journal——正式庫的 `__drizzle_migrations` 只有 16
> 列，補完之後 `migrate` 會試著重跑它們，而它們不是全部可重入的。

### 1-2　`MilestoneBadge` 整個元件渲染不到，而它背後那張清單在說謊

`navigation.ts` 裡沒有任何一筆設 `milestone`，而那顆徽章的三個呼叫端都要求
`!ready && section.milestone`——兩個條件永遠為假。於是它跟它整個里程碑對話框
是一塊**渲染不到的 UI**。

更糟的是 `src/lib/milestones.ts` 的硬寫清單裡有**七筆標著「沒做」而其實做好
了**（作品卡更多操作、集數編輯、集數詳情頁、集數列表其他檢視、鏡頭詳情、素材
中心頁面、說明中心）。那份清單的註解寫著「mostly derived from the navigation
tables … so a page that gets built drops off it on its own」——已經不成立。

**兩個選項，不要留第三種**：接回去並改成真的從 `navigation.ts` 推導，或者連同
那份 `EXTRA` 一起刪掉。留著一份沒人看得到又在說謊的清單是最糟的。

### 1-3　導覽的真相有四份副本，只有一份是對的

| 副本 | 狀態 |
| --- | --- |
| `src/lib/navigation.ts` | **對的那一份** |
| `docs/ROUTES.md` 的狀態欄 | 過時：`/tasks`、`/costs`、`/team`、`/settings` 標 M4，`/ai` 標 M3，小說／劇本／世界觀／角色／版本標 M2，分鏡／素材標 M3，審核標 M4——**全部已上線**。`/help` 整個不在表上 |
| `src/lib/help.ts` 的 `RAIL_HELP`／`TAB_HELP` | 手抄的第二份（12＋11 筆），已經缺了「使用說明」與「個人設定」 |
| `src/lib/milestones.ts` 的 `EXTRA` | 見 1-2 |

`navigation.ts` 的檔頭寫著「One definition drives the strip, the active-tab
highlight and the route table in the docs」。**現在不成立。** 寫一支腳本比對
`ROUTES.md` 與 `navigation.ts`，並把 `RAIL_HELP`／`TAB_HELP` 改成從
`navigation.ts` 推導。

另外 `navigation.ts:242` 的 `PROJECT_SUB_ROUTES = ['tasks']` 宣告了一條磁碟上
不存在的路由，而這個常數全專案零引用。

### 1-4　四張只寫不讀／只讀不寫的表

| 表 | 症狀 | 缺的是 |
| --- | --- | --- |
| `ai_outputs` | 每跑一次 AI 寫一批候選，**零處讀取** | 讀取端。候選比較、「這段是哪個候選採用的」都還不存在，而資料一直在累積 |
| `audio_revisions` | 上傳音樂寫一列錨點，**零處讀取**，也沒有任何路由加第二列 | 版本／伴奏切換 |
| `asset_licenses` | 只在新增音樂時寫一次、固定 `PENDING_REVIEW`，**零處 update** | 核准／到期日的入口。資產中心的「授權待確認 N / N」分子永遠等於分母，音樂庫的授權篩選有四個選項永遠篩不到東西 |
| `production_milestones` | **零處寫入**，沒有路由 | 建立入口。空狀態文案叫人去建立，而沒有地方可以建立 |

`ai_outputs` 最值得先做：寫入端是對的、資料是真的，缺的只是讀。

### 1-5　顯示永遠不會變的死欄位

- **`touchSession` 零呼叫端**（`src/lib/auth/session.ts:183`）。它的註解寫著
  「so the device list shows recent activity」，而 `/settings/profile` 每一列
  顯示的「3 天前活動」其實是「3 天前**登入**」。兩個修法都行：接到 session 驗
  證路徑上，或者把那一欄的文案改成「登入於」。
- **`ProjectsBrowser` 的「建立時間」排序沒有作用**。`listProjects` 沒收到
  filters，`ProjectCardData` 連 `createdAt` 都沒有。一個看起來有反應、實際什麼
  都沒變的控制項。
- **`insights.ts:457` 把分鏡生成的任務送去劇本編輯器**。不是 404，是去錯地
  方——產出在分鏡工作台。

### 1-6　停用但沒說原因（違反 spec v2 §4）

- `StoryboardWorkbench.tsx` 鏡頭詳情整張表單十三個 `disabled={!canWrite}`，
  沒有 `title`、旁邊也沒有說明。同樣形狀在 `OutlineBoard.tsx`、`BookTabs.tsx`。
- **反向的**：`CharacterBrowser.tsx` 收了 `canWrite` 卻只套在
  `PortraitGallery`。新增、刪除、身分編輯、欄位自動存、關係表單對唯讀成員全部
  可按，只會在 API 那一層失敗。
- `Tabs.tsx` 的 `TabItem.disabled` 沒有地方掛原因——這個 API 的形狀本身就讓人
  違規。

> 兩個人現在都是 OWNER 所以看不到。**加一個協作者帳號的當天就會看到。**

### 1-7　小的，各一兩行

- `ModelAssignments.tsx` 與 `SystemSettings.tsx` 的「思考程度」下拉**對七家供應
  商沒有作用**（`openai-compatible.ts` 不送任何 reasoning 參數）。同檔已經有
  「依供應商種類而異」的寫法，套過去就好。
- `NovelEditor.tsx` 的「備註與討論 `M2`」是永久空白區塊，而審稿意見早就做好了
  （`listReviewNotes` / `addReviewNote` + `/api/projects/*/review-notes`），編輯
  器手上就有 `documentId`。
- `WorldBrowser.tsx` 的「AI 世界觀助理 `M2`」面板條件永遠不會被評估，而**真的
  能用的兩顆 AI 按鈕就在同一頁的標頭**。
- `review-notes` GET 的 `anchorText` 永遠是空字串——POST 不收 anchor 欄位。審稿
  意見只能是整份文件層級，而 schema 與回應形狀都在承諾有段落層級。
- `DashboardParts.tsx` **整個檔案 277 行沒有任何人 import**。儀表板自己又寫了
  一套 `Tile`／`Panel`／`Donut`。
- `login/page.tsx:67` 硬寫「《一灶見山河》· 第一部《萬家燈火》」，另一份在
  `constants.ts` 的 `FLAGSHIP`。改作品名時頁面那一份會過時。

---

## 2. PWA 可以再往前（都不擋安裝）

目前**可安裝，沒有阻斷原因**。可以加的，照價值排：

1. manifest 加 `screenshots`（`narrow` 與 `wide` 各一張）——Android Chrome 才會
   給完整的安裝對話框，而不是只有 mini-infobar。
2. 自製「加到主畫面」提示：接 `beforeinstallprompt`，用
   `matchMedia('(display-mode: standalone)')` 判斷已安裝就不顯示。iOS 沒有這個
   事件，要另外用 `navigator.standalone` 偵測並出靜態說明。
3. manifest 加 `shortcuts`（`/projects`、`/tasks`、`/chat`）。
4. `display_override: ['window-controls-overlay', 'standalone']`。
5. maskable 只有 512，小尺寸啟動器會縮放；補一張 192。

---

## 3. 刻意沒做的

| | 為什麼 |
| --- | --- |
| **Z195** 丟掉 `shots.speaker_id` | Z194 的遷移是純新增的，所以「先跑遷移再部署」中間不會壞。代價是現在有一個沒人讀的欄位。**等這一版在線上穩了再丟**——丟掉就回不去，而留著不花什麼 |
| 匯入入口只在分鏡與小說兩頁 | 角色／世界觀／集數／任務／支出那幾頁還沒掛「匯入」鈕。資料層八個區塊都通了，缺的只是按鈕 |
| `notifications` 這張表 | 零筆、零引用。`src/lib/notifications.ts` 用的是瀏覽器 API，跟那張表無關 |
| 7 張完全沒碰的表 | `subtasks`、`task_comments`、`production_dependencies`、`asset_license_documents`、`version_branches`、`exports`、`notifications`。兩個人現在用不到 |

---

## 4. 數字對帳

| | |
| --- | --- |
| 條目總數 | **198**（Z0–Z197，連續、無重複） |
| 里程碑總覽 | 153 完成 / 193 |
| 差的五條 | Z34／Z42／Z43／Z45／Z46，指向別條的轉址，不掛徽章 |
| 測試 | 1,017 個，62 個檔案 |
| 路由 | 113 支、133 個處理函式、182 處呼叫，**沒有孤兒** |
| 連結 | 42 條路由、141 處連結，全部對得到 |
| 提交門檻 | 十支 + `vitest`（新增 `check:mojibake`） |

**`check:dead` 的兩條 ✗ 是基準線上的，不是新的**（100 個未用匯出、26 個未提及
欄位）。那份基準線的精確度偏低——它明寫「同檔自己用自己不算」，於是把
`assignmentFor`、`checkBudget`、`splitLedger` 這些**其實活著**的也列了進去。
值得重寫一次，但不急。
