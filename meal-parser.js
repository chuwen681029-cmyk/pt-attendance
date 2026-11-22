/* =========================================================
 * 菜單 Excel 解析器（瀏覽器端，需先載入 SheetJS xlsx.full.min.js）
 * 自動找出：日期／星期、主菜（葷）、素食
 * 支援兩種排法：
 *   A. 日期在同一列橫排（星期一～星期五），左邊第一欄是「主菜、副菜、素食…」
 *   B. 日期在同一欄直排，上方標題列是「日期、星期、主菜、素食…」
 * 也支援「素食」是另一個區塊（素食區塊底下再有一列主菜）、
 * 以及同一格寫「主菜：xxx」的格式。
 * ========================================================= */
(function (root) {
  'use strict';

  var CH = '一二三四五六日天';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function norm(s) { return String(s == null ? '' : s).replace(/[\s　]+/g, ''); }
  function clean(s) {
    return String(s == null ? '' : s).replace(/\r/g, '').split('\n')
      .map(function (t) { return t.trim(); }).filter(Boolean).join(' ').trim();
  }

  /* 判斷一格是不是「日期／星期」標題；回傳 {dow:1~7|null, date:{y,m,d}|null} */
  function dayInfo(v) {
    if (v instanceof Date && !isNaN(v)) {
      var x = new Date(v.getTime() + 12 * 3600 * 1000); // 避開時區誤差
      return { dow: ((x.getDay() + 6) % 7) + 1, date: { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate() } };
    }
    var s = norm(v);
    if (!s || s.length > 22) return null;
    var dow = null, m;
    if ((m = s.match(/(?:星期|週|周|禮拜|礼拜)([一二三四五六日天])/))) dow = CH.indexOf(m[1]) + 1;
    else if ((m = s.match(/[（(]([一二三四五六日])[)）]/))) dow = CH.indexOf(m[1]) + 1;
    else if ((m = s.match(/^(mon|tue|wed|thu|fri|sat|sun)/i))) dow = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(m[1].toLowerCase()) + 1;
    else if (/^[一二三四五六日]$/.test(s)) dow = CH.indexOf(s) + 1;
    if (dow === 8) dow = 7;

    var date = null;
    if ((m = s.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/))) date = { y: +m[1], m: +m[2], d: +m[3] };
    else if ((m = s.match(/(\d{2,3})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/))) date = { y: +m[1] + 1911, m: +m[2], d: +m[3] }; // 民國年
    else if ((m = s.match(/(?:^|[^\d])(\d{1,2})[\/\-.月](\d{1,2})(?:日|號)?(?!\d)/))) date = { y: null, m: +m[1], d: +m[2] };
    if (date && (date.m < 1 || date.m > 12 || date.d < 1 || date.d > 31)) date = null;

    // 有其他文字（像菜名）的不算標題
    if (dow == null && !date) return null;
    var rest = s.replace(/\d+/g, '').replace(/[\/\-.年月日號（）()星期週周禮拜礼拜一二三四五六日天]/g, '')
      .replace(/mon|tue|wed|thu|fri|sat|sun|day|nes|rs|ur/ig, '');
    if (rest.length > 2) return null;
    return { dow: dow, date: date };
  }

  /* 讀取工作表成二維陣列，合併儲存格填滿 */
  function sheetGrid(ws, XLSX) {
    var grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    var merges = ws['!merges'] || [];
    merges.forEach(function (mg) {
      var v = (grid[mg.s.r] || [])[mg.s.c];
      for (var r = mg.s.r; r <= mg.e.r; r++) {
        if (!grid[r]) grid[r] = [];
        for (var c = mg.s.c; c <= mg.e.c; c++) {
          if (r === mg.s.r && c === mg.s.c) continue;
          grid[r][c] = v;
        }
      }
    });
    var w = 0;
    grid.forEach(function (row) { if (row.length > w) w = row.length; });
    return grid.map(function (row) {
      var out = [];
      for (var i = 0; i < w; i++) out.push(row[i] === undefined ? '' : row[i]);
      return out;
    });
  }

  function transpose(g) {
    if (!g.length) return g;
    var out = [];
    for (var c = 0; c < g[0].length; c++) {
      var row = [];
      for (var r = 0; r < g.length; r++) row.push(g[r][c]);
      out.push(row);
    }
    return out;
  }

  /* 列的分類 */
  function classify(label) {
    var n = norm(label);
    return {
      veg: /素/.test(n),
      meat: /葷/.test(n),
      main: /主菜|主餐|主菜色|^主$|^葷$|^葷食$|^素$|^素食$|^素食餐$|^素菜$/.test(n),
      side: /副菜|配菜|青菜|蔬菜|湯|水果|點心|飲料|甜點|主食|飯|麵/.test(n) && !/主菜/.test(n),
      meal: /早餐/.test(n) ? '早' : /晚餐/.test(n) ? '晚' : /(午餐|中餐)/.test(n) ? '午' : null
    };
  }

  /* 在一個方向的表格裡找菜單 */
  function scanGrid(grid) {
    var blocks = [];
    var cur = null;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      var hits = [];
      for (var c = 0; c < row.length; c++) {
        var info = dayInfo(row[c]);
        if (info) hits.push({ c: c, info: info });
      }
      var distinct = {};
      hits.forEach(function (h) { distinct[JSON.stringify(h.info)] = 1; });
      if (hits.length >= 3 && Object.keys(distinct).length >= 3) {
        if (cur && cur.dataRows === 0 && cur.headerEnd === r - 1) {
          // 連續兩列標題（例如一列日期、一列星期）→ 合併
          hits.forEach(function (h) {
            var col = cur.cols.filter(function (x) { return x.c === h.c; })[0];
            if (col) {
              if (h.info.dow && !col.info.dow) col.info.dow = h.info.dow;
              if (h.info.date && !col.info.date) col.info.date = h.info.date;
            } else cur.cols.push({ c: h.c, info: h.info });
          });
          cur.headerEnd = r;
        } else {
          cur = { headerRow: r, headerEnd: r, cols: hits, rows: [], dataRows: 0 };
          blocks.push(cur);
        }
        continue;
      }
      if (cur) { cur.rows.push(r); cur.dataRows++; }
    }

    var results = [];
    blocks.forEach(function (b) {
      var firstCol = Math.min.apply(null, b.cols.map(function (x) { return x.c; }));
      var dayCols = b.cols.map(function (x) { return x.c; });
      var section = 'meat', meal = null;
      var days = b.cols.map(function (x) { return { info: x.info, c: x.c, cand: {} }; });

      function put(day, key, val, pri, mealKey) {
        val = clean(val);
        if (!val) return;
        var k = (mealKey || '-') + '|' + key;
        var old = day.cand[k];
        if (!old || pri > old.pri) day.cand[k] = { val: val, pri: pri };
      }

      b.rows.forEach(function (r) {
        var row = grid[r];
        var labelParts = [];
        for (var c = 0; c < firstCol; c++) if (clean(row[c])) labelParts.push(clean(row[c]));
        var label = labelParts.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' ');
        var vals = dayCols.map(function (c) { return clean(row[c]); });
        var nonEmpty = vals.filter(Boolean);
        var uniq = nonEmpty.filter(function (x, i, a) { return a.indexOf(x) === i; });

        // 整列只有一個相同文字 → 區塊標題（例如合併儲存格的「素食」）
        var sectionText = null;
        if (nonEmpty.length >= 2 && uniq.length === 1 && (!label || norm(label) === norm(uniq[0]))) sectionText = uniq[0];
        else if (!nonEmpty.length && label) sectionText = label;
        if (sectionText) {
          var sc = classify(sectionText);
          if (sc.meal) meal = sc.meal;
          if (sc.veg) section = 'veg';
          else if (sc.meat) section = 'meat';
          return;
        }

        var cl = classify(label);
        if (cl.meal) meal = cl.meal;
        var kind = null, pri = 0;
        if (cl.veg) {
          section = 'veg';
          if (cl.main) { kind = 'veg'; pri = /主/.test(norm(label)) ? 3 : 2; }
        } else if (cl.meat) {
          section = 'meat';
          if (cl.main || !cl.side) { kind = 'main'; pri = 3; }
        } else if (cl.main) {
          kind = section === 'veg' ? 'veg' : 'main';
          pri = 3;
        }

        days.forEach(function (d, i) {
          var v = vals[i];
          if (!v) return;
          if (kind) put(d, kind, v, pri, meal);
          // 同一格寫「主菜：xxx」「素食：xxx」
          var raw = String(row[d.c] == null ? '' : row[d.c]);
          var m1 = raw.match(/(?:葷食)?主菜\s*[:：]\s*([^\n\r]+)/);
          var m2 = raw.match(/素(?:食)?(?:主菜)?\s*[:：]\s*([^\n\r]+)/);
          if (m1 && !/素/.test(raw.slice(Math.max(0, m1.index - 2), m1.index))) put(d, 'main', m1[1], 1, meal);
          if (m2) put(d, 'veg', m2[1], 1, meal);
        });
      });

      days.forEach(function (d) {
        // 選餐別：有午餐就用午餐，否則用沒標餐別的，再不然用第一個
        var meals = {};
        Object.keys(d.cand).forEach(function (k) { meals[k.split('|')[0]] = 1; });
        var pick = meals['午'] ? '午' : meals['-'] ? '-' : Object.keys(meals)[0];
        var main = d.cand[pick + '|main'], veg = d.cand[pick + '|veg'];
        results.push({ info: d.info, block: blocks.indexOf(b), main: main ? main.val : '', veg: veg ? veg.val : '' });
      });
    });
    return { blocks: blocks.length, days: results };
  }

  /* 依週一日期，把星期／日期換算成實際日期 */
  function resolveDates(days, weekStart) {
    var ws = parseYmd(weekStart);
    var blockHasDate = {};
    days.forEach(function (d) { if (d.info.date) blockHasDate[d.block] = true; });
    var dowBlocks = [];
    days.forEach(function (d) { if (!blockHasDate[d.block] && dowBlocks.indexOf(d.block) < 0) dowBlocks.push(d.block); });

    var out = [];
    days.forEach(function (d) {
      var date = null;
      if (d.info.date) {
        var y = d.info.date.y;
        if (!y) {
          // 沒寫年份：挑最接近週一日期的年份
          var best = null;
          [ws.getFullYear() - 1, ws.getFullYear(), ws.getFullYear() + 1].forEach(function (yy) {
            var t = new Date(yy, d.info.date.m - 1, d.info.date.d);
            if (!best || Math.abs(t - ws) < Math.abs(best - ws)) best = t;
          });
          date = best;
        } else date = new Date(y, d.info.date.m - 1, d.info.date.d);
      } else if (d.info.dow) {
        date = addDays(ws, d.info.dow - 1 + dowBlocks.indexOf(d.block) * 7);
      }
      if (!date || isNaN(date)) return;
      out.push({ date: ymd(date), main: d.main, veg: d.veg });
    });

    // 同一天出現多次：保留有資料的
    var map = {};
    out.forEach(function (x) {
      var o = map[x.date];
      if (!o) map[x.date] = x;
      else { if (!o.main && x.main) o.main = x.main; if (!o.veg && x.veg) o.veg = x.veg; }
    });
    return Object.keys(map).sort().map(function (k) {
      var x = map[k];
      var dow = (parseYmd(k).getDay() + 6) % 7;
      return { date: k, dow: '一二三四五六日'[dow], main: x.main, veg: x.veg, serve: !!(x.main || x.veg) };
    });
  }

  function score(res) {
    return res.days.reduce(function (s, d) { return s + (d.main ? 2 : 0) + (d.veg ? 1 : 0); }, 0);
  }

  /**
   * 解析整個活頁簿
   * @param wb SheetJS workbook（請用 {cellDates:true} 讀取）
   * @param weekStart 'yyyy-MM-dd' 週一日期（Excel 只寫星期幾時用來換算）
   * @param sheetName 指定工作表（可省略，自動挑分數最高的）
   */
  function parseMenuWorkbook(wb, weekStart, sheetName, XLSX) {
    XLSX = XLSX || root.XLSX;
    var best = null;
    var names = sheetName ? [sheetName] : wb.SheetNames;
    names.forEach(function (name) {
      var grid = sheetGrid(wb.Sheets[name], XLSX);
      if (!grid.length) return;
      [['橫排', grid], ['直排', transpose(grid)]].forEach(function (pair) {
        var res = scanGrid(pair[1]);
        var sc = score(res);
        if (!best || sc > best.score) best = { score: sc, sheet: name, layout: pair[0], res: res };
      });
    });
    if (!best || best.score === 0) {
      return { ok: false, sheet: best ? best.sheet : '', sheets: wb.SheetNames, days: [],
        message: '找不到日期與主菜。請確認 Excel 裡有「星期一～五」或日期，以及「主菜」「素食」的標題；也可以在下方表格手動輸入。' };
    }
    var days = resolveDates(best.res.days, weekStart);
    var warn = [];
    days.forEach(function (d) {
      if (!d.main) warn.push(d.date + ' 沒找到主菜');
      if (d.main && !d.veg) warn.push(d.date + ' 沒找到素食');
    });
    return { ok: true, sheet: best.sheet, sheets: wb.SheetNames, layout: best.layout, days: days, warnings: warn };
  }

  var api = { parseMenuWorkbook: parseMenuWorkbook, dayInfo: dayInfo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MenuParser = api;
})(typeof window !== 'undefined' ? window : this);
