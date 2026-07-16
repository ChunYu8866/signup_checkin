# 活動報到上線與活動日操作手冊

## 1. 發布前程式驗證

在乾淨 checkout 執行，三個命令都必須以 exit code 0 完成，且最後一個命令不得顯示未預期變更：

```powershell
npm ci
npm run verify
git status --short
```

若任一檢查失敗，停止發布，不得略過測試或直接修改正式設定。

## 2. 資料與 Apps Script 檢查

1. 僅使用假姓名、假手機與假 E-mail 執行 smoke test；不得在終端或聊天室列印正式參加者資料。
2. 確認 `簽到表!A1:G1` 完全等於：`姓名`、`手機`、`E-mail`、`報名類型`、`報到狀態`、`報到時間`、`資料建立時間`。`報名表` 是 A:C 原始資料來源，報到程式不得直接寫入該分頁。
3. 確認試算表時區與 Apps Script 專案時區均為 `Asia/Taipei`。
4. 產出重複手機與重複 E-mail 報告；每一筆重複均須由授權人員處理，不得自動合併。
5. 在 Apps Script 編輯器執行 `validateDeployment()`；必須回傳 `ok: true`。
6. 刪除所有 smoke-test 假資料，再核對正式資料列數；不要把報告中的完整識別資料複製到工單或聊天。
7. **刪除假資料後**執行 `refreshIndexes()`；必須回傳 `ok: true`。此步會切換至新 generation 並依目前列號重建索引，確保已刪除識別資料不可查得、列位移不會指向錯誤參加者。
8. `warmIndexes()` 僅供資料未增刪、列號未變動時預熱目前 generation；不得用它取代刪除或移動資料後的 `refreshIndexes()`。
9. 報到開放期間禁止排序、插入、刪除或移動 `簽到表` 資料列。系統雖會以雜湊身分重新核對短效確認憑證，但結構異動仍應留到停止受理後進行；完成後必須執行 `refreshIndexes()` 再重新開放。
10. `簽到表` 最多容納 1,000 筆參加者資料（不含標題列）；`validateDeployment()` 會拒絕超量資料，現場新增也會在寫入鎖內再次檢查上限。

## 3. 部署設定

只使用瀏覽器實際觀察到的 Apps Script `/exec` URL 與 GitHub Pages URL：

```powershell
node scripts/configure-deployment.mjs --bridge-url $bridge --pages-url $pages
```

CLI 僅可輸出要填入 Script Properties `ALLOWED_ORIGINS` 的精確 origin。正式開放現場報名前，另須確認法務／法遵核准文字已完整提供，再使用 `--privacy-approved true --walk-in-enabled true --approved-notice <核准文字>` 產生設定。任一核准條件不足時維持兩個 gate 為 `false`。

## 4. 裝置驗收

- 使用實機 iPhone 掃 QR code：完成手機查詢、E-mail fallback、遮罩確認及報到；不得出現水平捲動或原始個資。
- 使用實機 Android 掃同一 QR code，重做相同流程。
- 若現場報名已核准開放，以假資料確認告知文字完整、同意方塊未預先勾選、重送不會新增第二列。
- 再掃一次已完成報到的假資料，確認只顯示第一次報到時間。

## 5. 活動日監控

- 指派工作人員持續查看 Apps Script「執行項目」儀表板，監看錯誤率、逾時與執行量；不得在日誌加入姓名、手機、E-mail、token 或 request payload。
- 定時抽查 Web App、GitHub Pages 與 QR code；遇到 `BUSY` 先讓等候室自動重試，不重複提交資料。
- 發現 header、時區、origin、重複資料或部署驗證錯誤時，立即停止線上報到並保留錯誤 request ID 供工程追查。

## 6. 故障切換

線上系統無法安全使用時，工作人員應立即引導參加者到**有人值守的人工報到櫃台**。試算表不得設為公開、不得把 Sheet URL 提供給參加者，也不得讓參加者直接操作試算表。由獲授權工作人員在受控裝置完成核對，系統恢復後再依核准程序補登。

## 7. 2026-07-16 部署證據

- 應用程式 release commit：`ae5133219cea17dc12d68c9cf8d5af3df62dc4d2`。
- Apps Script deployment：v2，2026-07-16 22:19（Asia/Taipei）；使用部署畫面實際觀察到的同一個 `/exec` URL。
- GitHub Pages：`https://chunyu8866.github.io/signup_checkin/`；workflow `https://github.com/ChunYu8866/signup_checkin/actions/runs/29506373282` 成功。
- CI：`https://github.com/ChunYu8866/signup_checkin/actions/runs/29506373370` 成功；本機同一 release 執行 59 unit + 29 E2E，全數通過。
- Sheet：正式目標為 `簽到表`，A1:G1 已核對為 `姓名｜手機｜E-mail｜報名類型｜報到狀態｜報到時間｜資料建立時間`；試算表與 Apps Script 時區均為 `Asia/Taipei`。`報名表` 僅作 A:C 原始來源。
- 正式唯讀 smoke：假手機查無資料後正確進入 E-mail fallback；假 E-mail 再查無資料後顯示「現場報名尚未開放」。health handshake 與 Apps Script 隨機 bridge origin 綁定成功，且沒有執行確認報到或寫入。
- 核准狀態：尚未取得主辦人核准的個資告知；`PRIVACY_NOTICE_APPROVED=false`、`WALK_IN_ENABLED=false`，僅可提供預先報名查詢／報到流程。
- 待驗收：尚未執行 iPhone Safari、Android Chrome 與 QR 實機測試；尚未執行三筆假資料寫入驗收、10/20/30 concurrency 量測、正式名單匯入、重複識別資料處理及最終主辦人 smoke。完成前不得宣稱實機驗收、穩定容量或正式名單已可上線。
