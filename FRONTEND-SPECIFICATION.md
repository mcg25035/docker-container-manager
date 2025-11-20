
# Docker Service Manager - 前端規格書 (Draft)

## 1. 專案概述
建立一個視覺化管理介面，透過 API 與 `DockerModule` 互動，實現對容器服務的狀態監控、生命週期管理（啟動/停止）、配置檢視以及高效能的日誌分析。

## 2. 建議技術堆疊 (Tech Stack)
*   **Framework**: React 或 Vue 3 (推薦使用 TypeScript)。
*   **UI Library**: Ant Design 或 MUI (適合管理後台風格)，或 Tailwind CSS (客製化彈性高)。
*   **State Management**: Zustand 或 Redux Toolkit (需處理大量日誌狀態)。
*   **Data Fetching**: React Query / TanStack Query (處理 API 快取與狀態同步)。
*   **Communication**:
    *   **HTTP**: 用於一般操作 (列表、搜尋、控制)。
    *   **WebSocket / SSE**: 用於 `monitorServiceLogs` (即時日誌串流)。

---

## 3. 頁面架構 (Sitemap)

1.  **首頁 / 服務儀表板 (Dashboard)**
    *   所有服務列表卡片
    *   全域狀態概覽
2.  **服務詳情頁 (Service Detail)**
    *   **控制面板 (Control Panel)**: 電源操作
    *   **配置檢視 (Config Viewer)**: .env 與 docker-compose.yml
    *   **日誌瀏覽器 (Log Explorer)**: 歷史搜尋與即時監控

---

## 4. 功能模組規格

### 4.1. 服務儀表板 (Dashboard)

**目標**: 讓使用者一眼看出哪些服務活著，哪些掛了。

| 元件/功能 | 對應後端方法 | UI 互動/行為 |
| :--- | :--- | :--- |
| **服務列表** | `listServices()` | 進入頁面時載入所有服務名稱。 |
| **狀態燈號** | `isServiceUp(name)` | 對每個服務異步檢查狀態。<br>🟢 Up (綠燈)<br>🔴 Down (紅燈)<br>⚪ Loading (灰燈閃爍) |
| **快速重啟** | `powerAction('restart')` | 列表項目的操作選單，允許不進入詳情頁直接重啟。 |

### 4.2. 服務詳情 - 控制面板 (Control Panel)

**目標**: 管理單一服務的生命週期。

| 元件/功能 | 對應後端方法 | UI 互動/行為 |
| :--- | :--- | :--- |
| **電源按鈕群** | `powerAction(type, name)` | 包含 Start, Stop, Restart, Down。<br>點擊後按鈕進入 Disable 狀態直到後端回傳結果。<br>顯示 Toast 通知操作結果 (Success/Error)。 |
| **狀態自動刷新** | `isServiceUp(name)` | 執行電源操作後，應每隔 2 秒輪詢一次狀態，直到狀態改變或超時。 |

### 4.3. 服務詳情 - 配置檢視 (Config Viewer)

**目標**: 檢查設定檔，確認環境變數是否正確。

| 元件/功能 | 對應後端方法 | UI 互動/行為 |
| :--- | :--- | :--- |
| **Env 表格** | `getServiceConfig()` | 解析回傳物件中的 `.env` 部分，以 Key-Value 表格呈現。 |
| **Compose 預覽** | `getServiceConfig()` | 解析回傳物件中的 `dockerCompose`，建議使用 YAML Syntax Highlighter (如 `react-syntax-highlighter`) 顯示。 |

### 4.4. 日誌瀏覽器 (Log Explorer) - **核心功能**

這是最複雜的部分，因為後端提供了三種不同的讀取模式（分頁、搜尋、監控）。UI 需要用 Tabs 或模式切換來區分。

**前置選擇**: 下拉選單選擇日誌檔案 (`getServiceLogs`)。

#### 模式 A: 歷史瀏覽 (Pagination Mode)
*使用一般分頁邏輯讀取日誌。*

| UI 元件 | 對應後端方法 | 邏輯 |
| :--- | :--- | :--- |
| **行數讀取器** | `getLogLines` | 預設載入最後 100 行 (`startLine: -100`)。<br>提供 "Load More Previous" 按鈕，向前讀取更多行數。 |

#### 模式 B: 時間範圍搜尋 (Time Travel Mode)
*利用後端的二元搜尋功能，快速定位特定時間點。*

| UI 元件 | 對應後端方法 | 邏輯 |
| :--- | :--- | :--- |
| **日期時間選擇器** | N/A | 選擇 Start Time 與 End Time (精確到秒)。 |
| **搜尋按鈕** | `searchLogLinesByTimeRange` | 發送 ISO String 時間戳記給後端。<br>若資料量過大，前端需處理虛擬列表 (Virtual Scroll) 渲染。 |

#### 模式 C: 即時監控 (Live Tail Mode)
*類似 `tail -f` 的體驗。*

| UI 元件 | 對應後端方法 | 邏輯 |
| :--- | :--- | :--- |
| **啟動/停止開關** | `monitorServiceLogs` | **開啟**: 建立 WebSocket/SSE 連線，後端回傳每行 Log 時，前端 Append 到陣列末端。<br>**關閉**: 斷開連線 (觸發後端的 `unwatch`)。 |
| **自動捲動 (Auto-scroll)** | N/A | 當有新 Log 進來時自動捲動到底部。使用者向上捲動時應暫停自動捲動。 |

---

## 5. API 介面定義 (建議)

雖然這是前端規格，但我們需要約定後端 API (假設有一個 Express/Fastify Server 包裝你的 `DockerModule`)。

| HTTP Method | Endpoint | 用途 | Request Body / Query |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/services` | 列表 | - |
| `GET` | `/api/services/:name/status` | 狀態 | - |
| `POST` | `/api/services/:name/power` | 電源 | `{ action: "start" | "stop" ... }` |
| `GET` | `/api/services/:name/config` | 配置 | - |
| `GET` | `/api/services/:name/logs/files` | 檔名列表 | - |
| `GET` | `/api/services/:name/logs/read` | 讀取行 | `?file=err.log&start=-100&num=100` |
| `POST` | `/api/services/:name/logs/search` | 時間搜尋 | `{ file: "x.log", from: "TS", to: "TS" }` |
| `WS` (WebSocket)| `/ws/logs/:name` | 即時串流 | Query: `?file=error.log` |

---

## 6. 開發順序建議

1.  **API Server Layer**: 先寫一個簡單的 Node.js Server (Express) 把 `DockerModule` 包成 REST API。
2.  **Dashboard**: 實作服務列表與狀態燈號 (最有成就感，最簡單)。
3.  **Log Viewer (Static)**: 實作 `getLogLines` 的分頁讀取。
4.  **Control**: 實作開關機與 Loading 狀態處理。
5.  **Log Search & Live**: 最後實作時間搜尋與 WebSocket 串流 (技術難度最高)。

你覺得這個規格方向如何？我們可以針對「日誌瀏覽器」的 UX 做更深入的討論，例如是否需要「關鍵字高亮」或「Log 等級過濾 (Info/Error)」(雖然目前後端只吐原始字串，但前端可以用 Regex 解析)。