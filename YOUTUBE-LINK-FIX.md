# YouTube 連結顯示修補

已確認正式 Firebase 的網站設定包含 https://www.youtube.com/@TanJi_2026。原本前台沒有顯示這個欄位，並非網址未儲存。

本次只在「聯絡我們」分頁表單下方加入置中的 YouTube↗ 連結，讀取既有設定；設定留白就隱藏。新分頁開啟，中文與英文皆適用。

將包內檔案按原路徑覆蓋至 tanji2026.github.io 儲存庫根目錄，等待 GitHub Pages 更新即可。不需要更動 Firebase、重新填網址或重新發布內容。

index.html、404.html 只調整 views.js 的快取版本參數。沒有修改後台、作品、探索方向、資料來源或既有樣式。
