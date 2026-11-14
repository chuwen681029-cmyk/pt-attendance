/**
 * PDCA 改善計畫報告（依「物理治療實習學生 PDCA 改善計畫 112.10.13 制定」）
 *
 * 觸發：
 *   1. 未於 3 個工作天前請假（逾期申請）→ 送出假單時自動派發
 *   2. 遲到 → 簽到判定遲到時自動派發（可在 Config.gs 關閉）
 * 規則：
 *   - 需於發生日後 3 個工作天內完成填寫與全部簽章，逾期以遲到論（出勤管理辦法 四、2）
 *   - 第一次違規只需寫 P、D、C；重複違規須補寫前一張的 A（行動），再寫本張的 P、D、C
 *   - 改善計畫內容需 100 字以上
 *   - 簽核：臨床指導老師 → 差勤負責老師 → 教學組長 → 計畫主持人（對應表單下方簽章欄）
 */

const PDCA_SHEET = 'PDCA';
const PDCA_HEADERS = ['PDCA編號', '建立時間', '編號', '姓名', '類型', '違規日期', '關聯單號', '違規事項',
  '說明', '改善目標', 'Plan', 'Do', 'Check', 'Action', '前次PDCA編號', '前次Action',
  '臨床指導老師編號', '期限', '狀態', '目前關卡', '簽核摘要', '簽核紀錄JSON', '提交時間', '完成時間', '逾期'];
const PDCA_STATUS = { TODO: '待填寫', REVISE: '退回修改', SIGNING: '簽核中', DONE: '已完成' };

/* ---------- 建立 ---------- */

/**
 * 派發一張 PDCA 給學生
 * @param {Object} student 人員列
 * @param {string} type 類型（未於三日前請假／遲到）
 * @param {string} date 違規日期 yyyy-MM-dd
 * @param {string} ref 關聯單號（假單編號等）
 * @param {string} desc 違規事項（系統自動帶入）
 * @param {string[]} teacherIds 臨床指導老師編號
 */
function createPdca_(student, type, date, ref, desc, teacherIds, people) {
  const all = readTable_(PDCA_SHEET);
  if (ref && all.some(x => x['關聯單號'] === ref)) return null;           // 同一事件不重複派發
  const mine = all.filter(x => x['編號'] === student['編號']).sort((a, b) => a['建立時間'].localeCompare(b['建立時間']));
  const prev = mine[mine.length - 1];
  const now = nowInfo_();
  const due = addWorkingDays_(date, CONFIG.PDCA_DUE_WORKING_DAYS, holidaySet_());
  const rec = {
    'PDCA編號': 'P' + now.ymd.replace(/-/g, '') + now.time.replace(/:/g, '') + Math.floor(Math.random() * 90 + 10),
    '建立時間': now.stamp, '編號': student['編號'], '姓名': student['姓名'], '類型': type, '違規日期': date,
    '關聯單號': ref || '', '違規事項': desc, '說明': '', '改善目標': '', 'Plan': '', 'Do': '', 'Check': '', 'Action': '',
    '前次PDCA編號': prev ? prev['PDCA編號'] : '', '前次Action': '',
    '臨床指導老師編號': (teacherIds || []).join('、'), '期限': due,
    '狀態': PDCA_STATUS.TODO, '目前關卡': '', '簽核摘要': '', '簽核紀錄JSON': '[]', '提交時間': '', '完成時間': '', '逾期': '',
  };
  appendRow_(PDCA_SHEET, rec);
  const link = liffLink_('pdca');
  notifyPerson_(student, '【PDCA 改善計畫】' + type + '（' + date + '）\n' + desc +
    '\n請於 ' + due + ' 前在系統上完成填寫與全部簽章，逾期以遲到論。' +
    (prev ? '\n※ 這是重複違規，需一併補寫前一張 PDCA 的 A（行動）。' : '') + (link ? '\n填寫：' + link : ''));
  return rec;
}

/* ---------- 簽核關卡 ---------- */

function pdcaApprovers_(p, step, people) {
  const active = people.filter(x => x['狀態'] !== '停用');
  if (step === '臨床指導老師') {
    const ids = String(p['臨床指導老師編號'] || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean);
    return active.filter(x => ids.includes(x['編號']));
  }
  return active.filter(x => rolesOf_(x).includes(step));
}

function pdcaNextStep_(p, fromIndex, people, log) {
  for (let i = fromIndex + 1; i < CONFIG.PDCA_CHAIN.length; i++) {
    const step = CONFIG.PDCA_CHAIN[i];
    if (pdcaApprovers_(p, step, people).length) return step;
    log.push({ step, by: '', name: '系統', decision: '略過', comment: '無此關卡人員', time: nowInfo_().stamp });
  }
  return null;
}

function pendingPdcaFor_(me, people) {
  let rows = [];
  try { rows = readTable_(PDCA_SHEET); } catch (e) { return []; }
  return rows.filter(p => p['狀態'] === PDCA_STATUS.SIGNING && p['目前關卡'] &&
    pdcaApprovers_(p, p['目前關卡'], people).some(x => x['編號'] === me['編號']));
}

function pdcaTodoFor_(studentId) {
  let rows = [];
  try { rows = readTable_(PDCA_SHEET); } catch (e) { return []; }
  return rows.filter(p => p['編號'] === studentId && (p['狀態'] === PDCA_STATUS.TODO || p['狀態'] === PDCA_STATUS.REVISE));
}

/* ---------- 檢視 ---------- */

function pdcaView_(p, all) {
  const prev = p['前次PDCA編號'] ? (all || readTable_(PDCA_SHEET)).find(x => x['PDCA編號'] === p['前次PDCA編號']) : null;
  let log = [];
  try { log = JSON.parse(p['簽核紀錄JSON'] || '[]'); } catch (e) { log = []; }
  return {
    id: p['PDCA編號'], created: p['建立時間'], studentId: p['編號'], student: p['姓名'], type: p['類型'],
    date: p['違規日期'], ref: p['關聯單號'], desc: p['違規事項'], explain: p['說明'], goal: p['改善目標'],
    plan: p['Plan'], do: p['Do'], check: p['Check'], prevId: p['前次PDCA編號'], prevAction: p['前次Action'],
    prev: prev ? { id: prev['PDCA編號'], date: prev['違規日期'], type: prev['類型'], plan: prev['Plan'], do: prev['Do'], check: prev['Check'] } : null,
    due: p['期限'], status: p['狀態'], step: p['目前關卡'], log, overdue: p['逾期'] === '是',
    submitted: p['提交時間'], done: p['完成時間'],
  };
}

function findPdca_(id) {
  const p = readTable_(PDCA_SHEET).find(x => x['PDCA編號'] === String(id));
  if (!p) fail_('找不到 PDCA');
  return p;
}

/* ---------- API ---------- */

const PDCA_API = {
  /** 我的 PDCA */
  myPdca(body, ctx) {
    const me = requireStudent_(ctx);
    const all = readTable_(PDCA_SHEET);
    const list = all.filter(p => p['編號'] === me['編號']).sort((a, b) => b['建立時間'].localeCompare(a['建立時間']));
    return { pdcas: list.map(p => pdcaView_(p, all)), minChars: CONFIG.PDCA_MIN_CHARS };
  },

  /** 學生送出 PDCA */
  pdcaSubmit(body, ctx) {
    const me = requireStudent_(ctx);
    return withLock_(() => {
      const p = findPdca_(body.pdcaId);
      if (p['編號'] !== me['編號']) fail_('只能填寫自己的 PDCA');
      if (p['狀態'] !== PDCA_STATUS.TODO && p['狀態'] !== PDCA_STATUS.REVISE) fail_('此 PDCA 目前為「' + p['狀態'] + '」，不能修改');
      const t = k => String(body[k] || '').trim();
      const fields = { explain: '說明', goal: '改善目標', plan: 'Plan', do: 'Do', check: 'Check' };
      for (const k of Object.keys(fields)) if (!t(k)) fail_('請填寫「' + (k === 'explain' ? '違規說明' : fields[k]) + '」');
      const chars = (t('goal') + t('plan') + t('do') + t('check')).replace(/\s/g, '').length;
      if (chars < CONFIG.PDCA_MIN_CHARS) fail_('改善目標與 P、D、C 合計需 ' + CONFIG.PDCA_MIN_CHARS + ' 字以上（目前 ' + chars + ' 字）');
      if (p['前次PDCA編號'] && !t('prevAction')) fail_('重複違規，請補寫前一張 PDCA 的 A（行動）');

      const log = (() => { try { return JSON.parse(p['簽核紀錄JSON'] || '[]'); } catch (e) { return []; } })();
      log.push({ step: '學生', by: me['編號'], name: me['姓名'], decision: p['狀態'] === PDCA_STATUS.REVISE ? '修改後送出' : '送出', comment: '', time: nowInfo_().stamp });
      const people = ctx.people;
      const first = pdcaNextStep_(p, -1, people, log);
      updateRow_(PDCA_SHEET, p._row, {
        '說明': t('explain'), '改善目標': t('goal'), 'Plan': t('plan'), 'Do': t('do'), 'Check': t('check'),
        '前次Action': t('prevAction'), '提交時間': nowInfo_().stamp,
        '狀態': first ? PDCA_STATUS.SIGNING : PDCA_STATUS.DONE, '目前關卡': first || '',
        '完成時間': first ? '' : nowInfo_().stamp,
        '簽核紀錄JSON': JSON.stringify(log), '簽核摘要': logSummary_(log),
      });
      if (p['前次PDCA編號']) {
        const prev = readTable_(PDCA_SHEET).find(x => x['PDCA編號'] === p['前次PDCA編號']);
        if (prev) updateRow_(PDCA_SHEET, prev._row, { 'Action': t('prevAction') });
      }
      if (first) notifyPdcaApprovers_(p, first, people);
      return { message: first ? '已送出，等待「' + first + '」簽核' : '已完成' };
    });
  },

  /** 老師簽核 PDCA */
  pdcaApprove(body, ctx) {
    const me = requireMe_(ctx);
    return withLock_(() => {
      const people = ctx.people;
      const p = findPdca_(body.pdcaId);
      if (p['狀態'] !== PDCA_STATUS.SIGNING) fail_('此 PDCA 目前為「' + p['狀態'] + '」，無需簽核');
      const step = p['目前關卡'];
      if (!pdcaApprovers_(p, step, people).some(x => x['編號'] === me['編號'])) fail_('您不是此 PDCA 目前關卡（' + step + '）的簽核人');
      const decision = body.decision === '退回' ? '退回' : '同意';
      const comment = String(body.comment || '').trim();
      if (decision === '退回' && !comment) fail_('退回請填寫需修改的地方');
      const now = nowInfo_();
      const log = (() => { try { return JSON.parse(p['簽核紀錄JSON'] || '[]'); } catch (e) { return []; } })();
      log.push({ step, by: me['編號'], name: me['姓名'], decision, comment, time: now.stamp });
      const student = people.find(x => x['編號'] === p['編號']);

      if (decision === '退回') {
        updateRow_(PDCA_SHEET, p._row, { '狀態': PDCA_STATUS.REVISE, '目前關卡': '', '簽核紀錄JSON': JSON.stringify(log), '簽核摘要': logSummary_(log) });
        notifyPerson_(student, '【PDCA 退回修改】' + p['類型'] + '（' + p['違規日期'] + '）\n' + step + ' ' + me['姓名'] + '：' + comment +
          '\n請於 ' + p['期限'] + ' 前修改後重新送出。');
        return { message: '已退回給學生修改' };
      }
      const next = pdcaNextStep_(p, CONFIG.PDCA_CHAIN.indexOf(step), people, log);
      const upd = { '簽核紀錄JSON': JSON.stringify(log), '簽核摘要': logSummary_(log) };
      if (next) {
        upd['目前關卡'] = next;
        updateRow_(PDCA_SHEET, p._row, upd);
        notifyPdcaApprovers_(p, next, people);
        return { message: '已同意，轉交「' + next + '」' };
      }
      upd['狀態'] = PDCA_STATUS.DONE; upd['目前關卡'] = ''; upd['完成時間'] = now.stamp;
      updateRow_(PDCA_SHEET, p._row, upd);
      const ontime = now.ymd <= p['期限'];
      notifyPerson_(student, '【PDCA 完成】' + p['類型'] + '（' + p['違規日期'] + '）已完成全部簽章' +
        (ontime ? '，於期限內完成。' : '，但已超過期限 ' + p['期限'] + '，依規定以遲到論。'));
      return { message: '已同意，PDCA 完成' };
    });
  },
};

function notifyPdcaApprovers_(p, step, people) {
  const link = liffLink_('approve');
  const text = '【待簽核 PDCA】\n' + p['姓名'] + '　' + p['類型'] + '（' + p['違規日期'] + '）\n期限：' + p['期限'] +
    '\n您的關卡：' + step + (link ? '\n前往簽核：' + link : '');
  pdcaApprovers_(p, step, people).forEach(x => notifyStep_(x, step, text, '[差勤] 待簽核 PDCA：' + p['姓名']));
}

/* ---------- 每日檢查：逾期 ---------- */

/** 回傳逾期名單文字（供每日報告使用），並把逾期者記為差勤異常 */
function checkPdcaOverdue_(people) {
  let rows = [];
  try { rows = readTable_(PDCA_SHEET); } catch (e) { return []; }
  const today = nowInfo_().ymd;
  const lines = [];
  rows.filter(p => p['狀態'] !== PDCA_STATUS.DONE).forEach(p => {
    if (today <= p['期限']) {
      lines.push('・' + p['姓名'] + '　' + p['類型'] + '（' + p['違規日期'] + '）' + p['狀態'] + '，期限 ' + p['期限']);
      return;
    }
    lines.push('・' + p['姓名'] + '　' + p['類型'] + '（' + p['違規日期'] + '）⚠ 已逾期（期限 ' + p['期限'] + '）');
    if (p['逾期'] === '是') return;
    updateRow_(PDCA_SHEET, p._row, { '逾期': '是' });
    appendRow_(SHEET.ANOMALY, {
      '日期': today, '編號': p['編號'], '姓名': p['姓名'], '類型': '遲到（PDCA逾期）',
      '說明': p['類型'] + '（' + p['違規日期'] + '）的 PDCA 未於 ' + p['期限'] + ' 前完成，依規定以遲到論',
      '建立時間': nowInfo_().stamp, '處理狀態': '待處理',
    });
    notifyPerson_(people.find(x => x['編號'] === p['編號']),
      '【PDCA 逾期】' + p['類型'] + '（' + p['違規日期'] + '）的 PDCA 未於 ' + p['期限'] + ' 前完成，依規定以遲到論。請盡快完成並找差勤負責老師說明。');
  });
  return lines;
}

/* ---------- 工具 ---------- */

/** 從某日起往後數 n 個工作天（不含當天） */
function addWorkingDays_(ymd, n, holidays) {
  let d = ymd, c = 0;
  while (c < n) { d = addDays_(d, 1); if (isWorkingDay_(d, holidays)) c++; }
  return d;
}
