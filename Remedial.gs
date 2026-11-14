/**
 * 學術活動補救教學
 *
 * 規則（2026-11-14 確認）：
 *  - 學術活動表定 16:00–17:00；學生請假涵蓋「15:00–17:00」時段且當天有學術活動 → 建立「待補救教學」
 *  - 假單「核准」時才建立並通知老師；撤回或退回的假單不會產生
 *  - 負責老師：報告＝主持老師（PT 後面那位）；課程＝上課老師（括號前面那位）；總後測＝該科負責人
 *    （已在「學術活動」表的「負責老師編號」欄整理好，可直接修改）
 *  - 老師補完後在 LINE「簽核」分頁按「已完成」；超過 14 天未完成提醒老師並列入每日報告
 *  - 物理治療行政暨教學會議、座談會、實習生引導課程不列入
 */

const ACT_SHEET = '學術活動';
const ACT_HEADERS = ['日期', '活動名稱', '類型', '負責老師編號', '負責老師', '共同老師', '報告學生編號', '備註'];
const REM_SHEET = '補救教學';
const REM_HEADERS = ['補救編號', '建立時間', '學生編號', '學生', '活動日期', '活動名稱', '類型', '負責老師編號', '負責老師',
  '假單編號', '報告者本人', '期限', '狀態', '完成時間', '老師備註', '已提醒'];
const REM_STATUS = { TODO: '待補救', DONE: '已完成', CANCELLED: '已取消' };

/** 某段請假涵蓋到的學術活動 */
function activitiesInLeave_(startDate, startSlot, endDate, endSlot, holidays) {
  let acts = [];
  try { acts = readTable_(ACT_SHEET); } catch (e) { return []; }
  const covered = enumerateLeaveSlots_(startDate, startSlot, endDate, endSlot, holidays)
    .filter(x => x.slot === CONFIG.ACTIVITY_SLOT).map(x => x.ymd);
  return acts.filter(a => covered.includes(normYmd_(a['日期'])) && a['負責老師編號']);
}

/** 假單核准後建立補救教學，回傳給學生看的說明文字 */
function createRemedialsForLeave_(leave, people) {
  const acts = activitiesInLeave_(leave['開始日期'], slotIndex_(leave['開始時段']),
    leave['結束日期'], slotIndex_(leave['結束時段']), holidaySet_());
  if (!acts.length) return '';
  const existing = readTable_(REM_SHEET);
  const now = nowInfo_();
  const lines = [];
  acts.forEach(a => {
    const date = normYmd_(a['日期']);
    if (existing.some(r => r['假單編號'] === leave['假單編號'] && r['活動日期'] === date)) return;
    const teacher = people.find(p => p['編號'] === a['負責老師編號']);
    const presenter = String(a['報告學生編號'] || '') === leave['編號'];
    const due = addDays_(date > now.ymd ? date : now.ymd, CONFIG.REMEDIAL_DUE_DAYS);
    appendRow_(REM_SHEET, {
      '補救編號': 'R' + now.ymd.replace(/-/g, '') + now.time.replace(/:/g, '') + Math.floor(Math.random() * 900 + 100),
      '建立時間': now.stamp, '學生編號': leave['編號'], '學生': leave['姓名'], '活動日期': date,
      '活動名稱': a['活動名稱'], '類型': a['類型'], '負責老師編號': a['負責老師編號'],
      '負責老師': teacher ? teacher['姓名'] : a['負責老師'], '假單編號': leave['假單編號'],
      '報告者本人': presenter ? '是' : '', '期限': due, '狀態': REM_STATUS.TODO, '完成時間': '', '老師備註': '', '已提醒': '',
    });
    if (teacher) {
      notifyPerson_(teacher, '【補救教學】' + leave['姓名'] + ' 請假已核准，將缺席\n' + date + ' ' + a['活動名稱'] +
        (presenter ? '\n※ 此生是當天的報告者，請另行安排報告時間。' : '') +
        '\n請於 ' + due + ' 前安排補救教學，完成後到系統「簽核」分頁按「已完成」。' +
        (liffLink_('approve') ? '\n' + liffLink_('approve') : ''));
    }
    lines.push(date + ' ' + a['活動名稱'] + '（' + (teacher ? teacher['姓名'] : a['負責老師']) + '）');
  });
  return lines.length ? '\n請假期間的學術活動已通知老師安排補救教學：\n・' + lines.join('\n・') : '';
}

function pendingRemedialsFor_(me) {
  let rows = [];
  try { rows = readTable_(REM_SHEET); } catch (e) { return []; }
  return rows.filter(r => r['狀態'] === REM_STATUS.TODO && r['負責老師編號'] === me['編號']);
}

function remedialView_(r) {
  return {
    id: r['補救編號'], student: r['學生'], studentId: r['學生編號'], date: r['活動日期'], name: r['活動名稱'],
    type: r['類型'], teacher: r['負責老師'], leaveId: r['假單編號'], presenter: r['報告者本人'] === '是',
    due: r['期限'], status: r['狀態'], doneAt: r['完成時間'], note: r['老師備註'],
    overdue: r['狀態'] === REM_STATUS.TODO && nowInfo_().ymd > r['期限'],
  };
}

const REMEDIAL_API = {
  /** 老師標記補救教學完成 */
  remedialDone(body, ctx) {
    const me = requireMe_(ctx);
    return withLock_(() => {
      const r = readTable_(REM_SHEET).find(x => x['補救編號'] === String(body.remedialId));
      if (!r) fail_('找不到補救教學紀錄');
      if (r['負責老師編號'] !== me['編號'] && !isAdmin_(me)) fail_('只有負責老師可以標記完成');
      if (r['狀態'] !== REM_STATUS.TODO) fail_('此筆已' + r['狀態']);
      updateRow_(REM_SHEET, r._row, { '狀態': REM_STATUS.DONE, '完成時間': nowInfo_().stamp, '老師備註': String(body.note || '').trim() });
      return { message: '已標記完成：' + r['學生'] + ' ' + r['活動名稱'] };
    });
  },
};

/** 每日檢查：逾期未補救 → 提醒老師一次，並回傳報告文字 */
function checkRemedialOverdue_(people) {
  let rows = [];
  try { rows = readTable_(REM_SHEET); } catch (e) { return []; }
  const today = nowInfo_().ymd;
  const lines = [];
  rows.filter(r => r['狀態'] === REM_STATUS.TODO && today > r['期限']).forEach(r => {
    lines.push('・' + r['學生'] + '　' + r['活動日期'] + ' ' + r['活動名稱'] + '（' + r['負責老師'] + '，期限 ' + r['期限'] + '）');
    if (r['已提醒'] === '是') return;
    updateRow_(REM_SHEET, r._row, { '已提醒': '是' });
    notifyPerson_(people.find(p => p['編號'] === r['負責老師編號']),
      '【補救教學提醒】' + r['學生'] + ' 的 ' + r['活動日期'] + ' ' + r['活動名稱'] + ' 補救教學已超過期限 ' + r['期限'] +
      '，完成後請到系統「簽核」分頁按「已完成」。');
  });
  return lines;
}
