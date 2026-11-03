# 路由與導覽架構（B+）

> **決策日期**：2026-11-03
> **狀態**：已定案，優先於 `UI Design/` 的 80 張視覺稿。
> 視覺稿保留作為**版面與樣式**的參考；**架構以本文為準**。

---

## 1. 決策內容

導覽分成兩層，彼此不重複：

| 層級 | 範圍 | 位置 |
|---|---|---|
| **全域側欄** | 跨作品功能 | 左側常駐 |
| **作品工作區 Tab** | 單一作品內的所有功能 | `/projects/[projectId]` 的共用 layout |

### 為什麼

原本的設計（以及我在 2026-11-03 之前的實作）把「小說編輯器」「分鏡工作台」「素材管理」這些**屬於某一個作品**的功能放在全域側欄。從側欄點進去時，系統不知道要編哪一個作品的小說。

我當時用 `resolveLeaf()` 把網址裡的 projectId 代進側欄連結來擋住這個洞 —— **那是過渡相容，不是長期架構**，等作品工作區 layout 完成後就該移除。

---

## 2. 全域側欄（跨作品）

只保留這六項：

| 項目 | 路由 | 說明 |
|---|---|---|
| 工作室儀表板 | `/dashboard` | 跨作品 KPI 與摘要 |
| 作品列表 | `/projects` | 全部作品 |
| 跨作品任務 | `/tasks` | 不分作品的任務總覽 |
| 成本中心 | `/costs` | 跨作品成本 |
| 團隊管理 | `/team` | 成員與權限 |
| 系統設定 | `/settings` | 含匯率、AI 供應商、帳號安全 |

**全域側欄不得再出現任何需要 projectId 的項目。**

---

## 3. 作品工作區 `/projects/[projectId]/...`

共用 `src/app/(studio)/projects/[projectId]/layout.tsx`，由 `ProjectWorkspaceLayout` 統一負責：

- 作品資訊列（標題、狀態、標籤）
- Tab 導覽
- **權限檢查**（見第 5 節）
- 切換作品入口

### Tab 與路由

| Tab | 路由 | 對應設計圖 |
|---|---|---|
| 總覽 | `/projects/[id]` | 04 |
| 集數 | `/projects/[id]/episodes` | 05 |
| 劇本 | `/projects/[id]/script` | 06, 07 |
| 世界觀 | `/projects/[id]/world` | 09 |
| 角色 | `/projects/[id]/characters` | 10, 11 |
| 分鏡 | `/projects/[id]/storyboard` | 12, 13 |
| 素材 | `/projects/[id]/assets` | 14, 15, 16 |
| 製作 | `/projects/[id]/production` | 17 |
| 審核 | `/projects/[id]/reviews` | 57, 58 |
| 版本 | `/projects/[id]/versions` | 08 |
| 設定 | `/projects/[id]/settings` | 21 |

---

## 4. projectId 必須以 URL 為準

**不得**依賴任何「全域目前作品」狀態（React context、cookie、localStorage、session 欄位都不行）。

必須正常運作的情境：

- 直接貼上深層連結開啟
- 重新整理
- 多個瀏覽器分頁各開不同作品
- 兩位成員同時各看各的作品

切換作品 = 導向另一個 `projectId` 的同一個 Tab，不是改某個全域變數。

---

## 5. 後端才是權限的真正位置

前端導覽只是方便。**每一個讀寫都必須在伺服器端依 projectId 隔離並檢查權限**，不得假設使用者只會從 UI 進來。

具體要求：

- 每個 query 都要有 `where projectId = ?`，不能靠「反正 UI 只會傳對的 id」
- 存取不屬於自己的作品 → 404（不是 403，避免洩漏作品是否存在）
- RBAC 檢查在 route handler 或資料層，不在元件
- layout 的檢查不算數：`layout.tsx` 不會在每次 route handler 呼叫時重跑

---

## 6. 規模：120 集只是目前這部作品的設定

《一灶見山河》目前是 120 集 × 9 階段 = 1080 筆階段紀錄。**這是資料，不是系統上限。**

- 不得在任何地方寫死 120、9 或 1080
- 05 集數列表必須支援分頁、搜尋、篩選
- 17 製作進度必須支援分段、階段聚合與虛擬化
- 01 儀表板與 04 總覽只顯示摘要與最近/重要集數，不攤開全部

---

## 7. 實作狀態

### 已完成（2026-11-03）

| 項目 | 位置 |
|---|---|
| 作品工作區 layout | `src/app/(studio)/projects/[projectId]/layout.tsx` |
| 工作區頁首／Tab／切換作品 | `src/components/studio/ProjectWorkspaceChrome.tsx` |
| 權限與 projectId 隔離 | `src/lib/project-access.ts` |
| 全域側欄裁減成六項 | `src/lib/navigation.ts` |
| `PROJECT_TABS` 單一定義 | `src/lib/navigation.ts` |
| 移除 `resolveLeaf()` 過渡補丁 | 已刪 |
| 04 不再自己畫 Hero 與 Tab | `ProjectOverview.tsx` 只剩內容 |
| 測試 | `tests/navigation.test.ts`、`tests/projects.test.ts` |

實測：工作區 200、未實作的 Tab 手打網址 404、`garbage` / `_` / 不存在的 UUID
全部 404（不是 500）、側欄不再出現任何作品相關項目。

**malformed uuid 必須自己擋**：Postgres 對格式錯誤的 uuid 是丟錯而不是回空集合，
id 直接進 SQL 會讓 `/projects/garbage` 變成 500。`isProjectId()` 負責這件事，
`tests/projects.test.ts` 有回歸測試。

### 待辦

| 項目 | 說明 |
|---|---|
| 01 / 04 / 05 / 17 版面 | 等 GPT 修正後的設計圖 |
| 跨作品任務 `/tasks` | M4 |
| 成本中心 `/costs` | M4 |
| 團隊管理 `/team` | M4 |
| 系統設定 `/settings` | M4，含匯率設定 |
| API route 的 `requireProjectApi()` | 目前只有頁面層用到；新增作品相關 API 時必須呼叫 |
