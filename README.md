# TanJi 碳吉 官方網站

正式版以 GitHub `tanji2026/official` 的 `be5c1b2` 為基礎，套用確認的深紫色設計。前端繼續放 GitHub Pages，內容後台與聯絡訊息使用既有 Firebase 專案 `tanji-official-1219f`。

## 本次調整

- 首頁與導覽順序一致：首頁、關於碳吉、探索方向、競賽作品、聯絡我們。
- 品牌中英文統一淡紫色，頁首、頁尾使用相同樣式；頁尾不重複信箱與介紹句。
- 首頁作品使用實際網站截圖的橫向視窗；作品分頁提供兩欄列表、分類與頁碼，手機單欄。
- 作品名稱置中白字，淡紫漸層底與短線；競賽成果膠囊及「查看作品↗」維持確認的對齊方式。
- 所有作品連結直接開啟作品網站，不產生個別介紹頁。
- 刪除箭頭前的空白，移除探索方向頁的指定註記、關於頁額外連結及獨立碳吉寶寶頁。
- 目前公開 7 件參賽作品、8 筆競賽紀錄。`tj2`、`tj4` 因目前沒有對應參賽紀錄而設為草稿，資料未刪除。

## 更新上線

1. 先下載或另存目前 GitHub 版本，及後台「版本與備份」的 JSON 備份。
2. 將這份資料夾**裡面的檔案與資料夾**上傳至 `official` 儲存庫根目錄，覆蓋同名檔案。保留 `CNAME` 內容 `tanji.tw`。務必一併上傳 `assets/`、`data/`，不能只上傳 `index.html`。
3. GitHub Pages 繼續使用原本分支的根目錄，不需要改網域設定。
4. 聯絡表單要使用新版 `firestore.rules`。在這個資料夾開啟終端機執行：

   ```sh
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project tanji-official-1219f
   ```

   也可以在 Firebase Console → Firestore Database → Rules，完整貼入本資料夾 `firestore.rules` 並發布。規則保留原有內容、草稿與歷史紀錄的管理權限。
5. 等 GitHub Pages 更新完成後，重新整理 `https://tanji.tw/`。登入 `https://tanji.tw/admin.html`，確認原本的雲端內容可正常讀取。
6. 在正式網址填寫一筆自用測試訊息，成功送出後，登入後台「聯絡訊息」→「重新讀取」確認收到。

本次沒有直接修改 GitHub 遠端分支，也沒有部署 Firebase 規則。

## 聯絡表單

- 網站直接將訊息寫入 Firestore `inquiries`，不再開啟訪客的郵件程式。
- 按鈕為「送出訊息」。只有 Firebase 確認寫入後才顯示成功；失敗會保留輸入內容。
- 收件內容只允許指定 Google 管理員讀取；一般訪客無法讀取訊息。
- 後台「聯絡訊息」可讀取最近 100 筆並標記已讀。完整紀錄保留在 Firestore。
- **不會自動寄通知到 Gmail**。這版以後台收件為準；日後可另外加上寄信通知。
- 尚未部署新版規則時，網站仍可瀏覽，但表單會顯示送出失敗，不會假裝已收到。
- 此版本做了欄位檢查與管理員讀取限制，未加入 CAPTCHA 或 App Check。若日後有垃圾訊息，再追加防濫用機制。

## 日後維護

### 一般內容更新：使用後台

開啟 `admin.html`，以 `tanji2026@gmail.com` 的 Google 帳號登入。編輯後可先儲存草稿，確認後再發布；版本備份及還原流程沿用原本設計。雲端已發布內容優先，讀取失敗時使用網站內附內容。

新增作品時：

1. 新增作品，填寫中英文名稱、簡介、分類、展示網址與「圖片」欄位。
2. 圖片請放作品的實際截圖，可用 HTTPS 圖片網址，或先上傳到 `assets/images/` 後填 `./assets/images/檔名.jpg`。
3. 在競賽成果新增對應紀錄，將 `projectId` 指向作品 ID。
4. 確認作品、成果都標記公開，再發布。

**公開列表會自動只顯示有公開競賽紀錄的公開作品。** 這個條件也適用原本已發布的雲端內容，所以舊資料不會把未參賽作品帶回。未參賽構想可留在草稿；將來參賽後新增對應紀錄即可公開，不用改程式。

同一作品可對應多筆競賽成果。首頁以競賽紀錄展示，因此相同作品可能出現多次；作品分頁則每件作品一張卡片，集中列出其紀錄。

### 本機內容更新

- `seed.json`：可維護的原始內附內容，也保留草稿。
- `data/content.js`：瀏覽器直接載入的內附內容。
- 編輯 `seed.json` 後執行 `node scripts/build-content.mjs`，再將兩者一起上傳。
- 若 Firebase 已有發布內容，僅修改本機備用資料不會蓋過雲端發布版；主要內容請在後台編輯發布。

### 程式結構

| 檔案 | 用途 |
| --- | --- |
| `index.html`、`404.html` | 靜態入口、GitHub Pages 相容入口 |
| `assets/css/site.css` | 官網排版及響應式樣式 |
| `assets/js/views.js` | 五個頁面的呈現與中英文介面文字 |
| `assets/js/site.js` | 導覽、語系、篩選、頁碼、橫向切換及聯絡表單 |
| `assets/js/media.js` | 既有作品截圖、探索方向圖形與角色圖片的路徑 |
| `assets/js/core.js` | 資料整理、驗證及共用方法 |
| `assets/js/firebase-config.js` | Firebase 瀏覽器設定及管理員帳號 |
| `assets/js/cloud.js` | Firebase 讀寫與 Google 登入 |
| `assets/js/admin.js`、`assets/css/admin.css` | 既有後台、聯絡訊息收件功能 |
| `assets/images/` | 實際作品截圖、方向圖形、原始碳吉寶寶圖片 |
| `firestore.rules` | 內容與聯絡訊息權限 |
| `tests/site.test.cjs` | 顯示條件與版本回歸檢查 |

不需要安裝前端框架或建置套件。GitHub Pages 直接提供靜態檔案。圖片與樣式不是寫死在 HTML 內，日後可各自更換。

## 驗證

```sh
npm test
```

測試包括：首頁順序、7 件參賽作品／8 筆紀錄、舊雲端資料過濾、新增作品與紀錄的可擴充性、中英文呈現、箭頭間距、表單欄位與品牌一致性。

## Firebase 瀏覽器設定

Firebase Web config 是瀏覽器連線資訊，並非服務帳號私鑰。真正的管理權限仍由 Authentication 與 Firestore Rules 控制。請保留 Google Cloud API 金鑰限制與原有授權網域設定；不要將服務帳號 JSON 或私鑰上傳到儲存庫。

本次另以瀏覽器檢查桌面與 360px 手機版首頁、作品及表單，確認圖片載入、品牌同色、作品漸層與資訊對齊。尚未登入正式管理員或向正式 Firestore 寫入測試訊息；新版規則部署後請依上線步驟完成收件驗證。
