# TanJi 碳吉 官方網站

> 碳吉，探索永續解方的新創團隊。  
> 官方正式網址：[https://tanji.tw](https://tanji.tw)

---

## 專案架構概覽

本專案採 **GitHub Pages 靜態單頁式應用（SPA）** 搭配 **Firebase 雲端後端**，具備防覆蓋安全防護與自動化測試驗證。

- **前台託管**：GitHub Pages（儲存庫：tanji2026/tanji2026.github.io）
- **雲端專案**：Firebase tanji-official-1219f
- **管理員帳號**：tanji2026@gmail.com
- **品牌基調**：深色紫系（主色調 #c6b6ff），橫向競賽作品展示窗。

---

## 目錄與檔案職責

- assets/
  - css/               網站樣式表（主色調、排版、響應式佈局）
  - js/                前端核心 JavaScript（已收斂為 5 支核心）
    - core.js          核心驗證、資料合併（mergeContent）、文章資料模型
    - cloud.js         Firebase SDK 初始化、連線設定、資料讀寫
    - views.js         前台公開頁面與碳吉筆記 HTML 渲染模組
    - site.js          前台路由器（Hash Routing）與使用者互動
    - notes-admin.js   後台筆記獨立編輯器與狀態機
  - vendor/            第三方必要套件（DOMPurify 安全過濾器）
- data/ & seed.json    內建預設種子資料（離線備份與防覆蓋底稿）
- functions/           Firebase Cloud Functions 後端（發信與安全通知）
- tests/               6 組自動化回歸測試
- 404.html             SPA 單頁應用路由重新導向處理器
- CNAME                GitHub Pages tanji.tw 自訂網域設定
- admin.html           後台管理入口
- index.html           前台首頁入口
- firebase.json        Firebase 專案設定檔
- firestore.rules      Firestore 資料庫防火牆存取規則
- storage.rules        Cloud Storage 檔案儲存存取規則
- package.json         測試相依套件與指令設定

---

## 核心安全防護機制

1. **防空覆蓋機制（mergeContent）**：
   若 Firestore 雲端資料庫回傳空物件或欄位缺漏，前端會強制與 data/content.js（種子資料）合併，確保 7 件競賽作品與歷年成果永遠不破版。
2. **防誤發布警報（assertPublishSafe）**：
   後台發布前強制檢查作品與成果筆數，避免管理員誤刪重要架構。
3. **後台狀態機防卡死**：
   管理後台設有 12 秒載入逾時機制與授權失敗即刻阻斷，避免無窮重試。

---

## 日常維護與開發指令

### 1. 執行回歸測試
在每一次修改前端程式碼後，務必執行完整驗證：
npm test

### 2. 部署前端至正式網站
只要將變更推送到 main 分支，GitHub Pages 會在 1～2 分鐘內自動完成部署：
git add -A
git commit -m "docs: update README"
git push
