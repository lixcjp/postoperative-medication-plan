#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 index.html 中的计划数据'); process.exit(1); }
const sandbox = { window: {}, document: { addEventListener() {} }, console };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const plan = sandbox.window.__plan;
if (!plan) { console.error('计划数据加载失败'); process.exit(1); }
const { buildDay, dayOf, TOTAL_DAYS } = plan;

const pad = n => String(n).padStart(2, '0');
const dateStr = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const dtStr = (d, t) => `${dateStr(d)}T${t.replace(':', '')}00`;
const toMin = t => { const p = t.split(':').map(Number); return p[0] * 60 + p[1]; };
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const FREQ = { 7: '每2小时1次', 4: '每日4次', 3: '每日3次', 2: '每日2次', 1: '每日1次' };

function ics(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//术后用药计划//提醒//CN', 'CALSCALE:GREGORIAN'];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + ev.uid);
    lines.push('DTSTART:' + ev.dt);
    lines.push('DTEND:' + ev.dt);
    lines.push('SUMMARY:' + esc(ev.title));
    if (ev.desc) lines.push('DESCRIPTION:' + esc(ev.desc));
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(ev.title), 'TRIGGER:PT0M', 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

const full = [];
const merged = [];

for (let day = 1; day <= TOTAL_DAYS; day++) {
  const d = dayOf(day);
  const items = buildDay(day).filter(i => !i.meal);

  for (const it of items) {
    const cnt = it.total > 1 ? `（第${it.idx}/${it.total}次${it.key === 'tobra' ? ' · ' + FREQ[it.total] : ''}）` : '';
    const title = `${it.time} ${it.short} ${it.dose}${cnt}`;
    const desc = [it.route, it.note || '', it.gap5 ? '与上一种眼药水间隔5分钟' : ''].filter(Boolean).join(' / ');
    full.push({ uid: `full-${dateStr(d)}-${it.time.replace(':', '')}-${it.key}`, dt: dtStr(d, it.time), title, desc });
  }

  const groups = [];
  let cur = null;
  for (const it of items) {
    if (cur && it.drop && cur.items[cur.items.length - 1].drop && toMin(it.time) - toMin(cur.items[cur.items.length - 1].time) <= 15) {
      cur.items.push(it);
    } else {
      if (cur) groups.push(cur);
      cur = { items: [it] };
    }
  }
  if (cur) groups.push(cur);

  for (const g of groups) {
    const first = g.items[0];
    if (g.items.length === 1) {
      const it = first;
      const cnt = it.total > 1 ? `（第${it.idx}/${it.total}次${it.key === 'tobra' ? ' · ' + FREQ[it.total] : ''}）` : '';
      merged.push({ uid: `mg-${dateStr(d)}-${it.time.replace(':', '')}-${it.key}`, dt: dtStr(d, it.time), title: `${it.time} ${it.short} ${it.dose}${cnt}`, desc: [it.route, it.note || ''].filter(Boolean).join(' / ') });
    } else {
      const seqTitle = g.items.map(i => i.short).join(' → ');
      const seqDesc = g.items.map(i => {
        const cnt = i.total > 1 ? `（第${i.idx}/${i.total}次${i.key === 'tobra' ? ' · ' + FREQ[i.total] : ''}）` : '';
        return `${i.time} ${i.short} ${i.dose}${cnt}`;
      }).join('\n');
      merged.push({
        uid: `mg-${dateStr(d)}-${first.time.replace(':', '')}-grp`,
        dt: dtStr(d, first.time),
        title: `${first.time} 滴眼：${seqTitle}`,
        desc: `${seqDesc}\n每种眼药水之间间隔5分钟，滴后闭目1-2分钟，眼膏睡前最后用`
      });
    }
  }
}

fs.writeFileSync('术后用药提醒-完整版.ics', ics(full));
fs.writeFileSync('术后用药提醒-合并版.ics', ics(merged));
console.log('完整版（每次用药单独提醒）:', full.length, '条');
console.log('合并版（同一时段眼药水合并提醒）:', merged.length, '条');
