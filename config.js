/**
 * 前端設定檔（雲林台大PTs差勤系統）
 *  GAS_URL ：Apps Script 網頁應用程式網址（結尾為 /exec）
 *  LIFF_ID ：LINE Login channel「雲林台大PTs差勤系統」的 LIFF ID
 * 這兩個值都不是密碼，放在公開的 GitHub Pages 沒有安全疑慮。
 */
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwIyGtrBN2-Tn4Jma5GJfwcPRB5P92TfqPnSprd09sFtDw9wz4kkcQDFuEiqpvEco4e/exec',
  LIFF_ID: '2012607668-1QUb1OO7',
  QR_PERIOD_SEC: 10, // 需與 Config.gs 的 QR_PERIOD_SEC 相同
};
