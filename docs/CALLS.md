# 通話（Z99）

## 現在的狀況

你實測的診斷：

```
sig=stable  ice=disconnected  conn=failed  host=2  srflx=1  relay=0
```

讀法：

| 欄位 | 值 | 意思 |
| --- | --- | --- |
| `sig` | `stable` | **握手完成了**。offer / answer 都交換成功 |
| `host` | 2 | 拿到 2 個本機位址 |
| `srflx` | 1 | STUN 有回應，拿到 1 個對外位址 |
| `relay` | 0 | 沒有中繼伺服器（還沒設定） |
| `ice` | `disconnected` | 兩邊的位址配對不起來 |

握手那段已經修好了（原本 offer 會被丟掉，見 commit 記錄）。
**剩下的是真的穿不過 NAT**，這是 TURN 存在的理由。

---

## 為什麼 STUN 不夠

STUN 只做一件事：告訴你「從外面看，你的位址長什麼樣」。
兩邊拿到彼此的對外位址之後，直接連。

這在大多數家用路由器上可以，因為它們是 **cone NAT**：
你往外送過一次封包之後，那個port 就對任何人開著。

**對稱式 NAT（symmetric NAT）** 不是這樣：它對每個目的地開不同的 port。
你告訴對方的那個 port，只對 STUN 伺服器有效，對方打不進來。
行動網路、公司網路、部分 ISP 的 CGNAT 都是這種。

這種情況只有一個解法：**把流量交給一台兩邊都連得到的伺服器轉送**，
那就是 TURN。

---

## 設定 Cloudflare TURN

### 1. 建一把 TURN key

Cloudflare Dashboard → Realtime（舊名 Calls）→ TURN → 建立。
會拿到 **Key ID** 與 **API Token**。

### 2. 填進環境變數

```bash
CLOUDFLARE_TURN_KEY_ID=...
CLOUDFLARE_TURN_API_TOKEN=...
```

本機填 `.env.local`，線上填 Vercel 的環境變數。

**這兩個值只會留在伺服器端。** 瀏覽器拿到的是
`src/lib/turn.ts` 去 mint 的短期憑證（預設 6 小時），不是這把 key——
把長期 key 給前端，等於讓任何人用這個帳號的額度轉送流量。

### 3. 不用改程式

`iceServersForCall()` 會自己判斷：有設定就 mint，沒有就退回 STUN。
填完重新部署就會生效。

---

## 費用

Cloudflare 公告價：

- **STUN**：免費、無上限（`stun.cloudflare.com`）
- **TURN**：egress **$0.05 / GB**，前 **1,000 GB 免費**
  （與 SFU 共用同一份免費額度，不是各自 1,000 GB）
- 入站不計費，只算出站

兩個人視訊一小時大約 0.5–1 GB，所以 1,000 GB 講得很久。
而且 **TURN 只在點對點失敗時才會用到**——連得上的通話完全不經過它，
也就不計費。

> 定價會變。見 `docs/HARDCODED.md` 的原則：這類數字不要寫死在程式裡。
> 查核於 2026-11-04，來源：
> <https://developers.cloudflare.com/realtime/pricing/>

---

## 其他 TURN 供應商

不用 Cloudflare 的話，`app_settings` 的 `call.iceServers` 可以直接填：

```json
[
  { "urls": ["stun:stun.l.google.com:19302"] },
  {
    "urls": ["turn:your-server.example.com:3478"],
    "username": "...",
    "credential": "..."
  }
]
```

自架 coturn 也是這個形狀。
介面還沒做（Z87 系統設定），目前要直接寫資料庫。

---

## 怎麼確認有生效

通話面板上那行追蹤：

```
sig=stable ice=connected conn=connected host=2 srflx=1 relay=2
```

`relay` 大於 0 就表示 TURN 的候選位址有拿到。
接通之後那行會自己收起來。

如果 `relay=0` 而且設定填了，看伺服器 log 有沒有 `[turn] mint failed`
或 `[turn] mint error`——mint 失敗不會讓通話整個掛掉，會安靜地退回 STUN。
