'use strict';
const $ = id => document.getElementById(id);
const el = {
  form: $('analyzeForm'), symbol: $('symbol'), analyze: $('analyzeBtn'), status: $('status'), error: $('error'),
  market: $('market'), analysisPanel: $('analysisPanel'), analysis: $('analysis'), news: $('news'),
  modal: $('settingsModal'), settingsForm: $('settingsForm'), settingsError: $('settingsError'), settingsSuccess: $('settingsSuccess'),
  finnKey: $('finnhubKey'), harborKey: $('harborKey'), style: $('style'), days: $('newsDays'), instructions: $('instructions')
};
let lastReport = '';

function text(id, value) { $(id).textContent = value == null || value === '' ? '—' : String(value); }
function price(value, currency = 'USD') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n < 1 ? 4 : 2 }).format(n); }
  catch { return n.toFixed(2) + ' ' + currency; }
}
function signed(n, digits = 2) { n = Number(n); return Number.isFinite(n) ? ((n > 0 ? '+' : '') + n.toFixed(digits)) : '—'; }
function showError(message) { el.error.textContent = message || 'حدث خطأ غير متوقع.'; el.error.classList.remove('hidden'); }
function hideError() { el.error.textContent = ''; el.error.classList.add('hidden'); }
function setBusy(on, message) {
  el.analyze.disabled = on;
  el.analyze.textContent = on ? 'جارٍ التحليل…' : 'حلّل السهم ↗';
  el.status.textContent = message || 'جارٍ تجهيز التحليل…';
  el.status.classList.toggle('hidden', !on);
}
function renderNews(news, period) {
  el.news.replaceChildren();
  text('newsPeriod', period ? period.from + ' — ' + period.to : 'الأخبار المتاحة');
  if (!Array.isArray(news) || !news.length) {
    const div = document.createElement('p'); div.className = 'muted'; div.textContent = 'لا توجد أخبار متاحة لهذه الشركة خلال الفترة المحددة.'; el.news.appendChild(div); return;
  }
  for (const item of news) {
    const card = document.createElement('article'); card.className = 'news-card';
    const title = document.createElement('h4'); title.textContent = item.headline || 'عنوان غير متاح'; card.appendChild(title);
    if (item.summary) { const summary = document.createElement('p'); summary.textContent = item.summary; card.appendChild(summary); }
    const meta = document.createElement('div'); meta.className = 'news-meta';
    const source = document.createElement('span'); source.textContent = item.source || 'مصدر غير محدد'; meta.appendChild(source);
    if (item.datetime) { const date = document.createElement('span'); date.textContent = new Date(Number(item.datetime) * 1000).toLocaleDateString('ar-EG'); meta.appendChild(date); }
    if (item.url && /^https:\/\//i.test(item.url)) {
      const link = document.createElement('button'); link.className = 'news-link'; link.textContent = 'فتح الخبر ↗';
      link.addEventListener('click', () => window.xkTrade.openExternal(item.url).catch(() => {})); meta.appendChild(link);
    }
    card.appendChild(meta); el.news.appendChild(card);
  }
}
async function analyze(symbol) {
  hideError(); el.market.classList.add('hidden'); el.analysisPanel.classList.add('hidden'); setBusy(true);
  try {
    const result = await window.xkTrade.analyze(symbol);
    const d = result.data, q = d.quote, c = d.company, cur = c.currency || 'USD';
    text('company', c.name || d.symbol); text('companyMeta', (c.exchange || 'بورصة غير محددة') + ' · ' + (c.industry || 'الصناعة غير متاحة'));
    text('ticker', d.symbol); text('price', price(q.current, cur)); text('high', price(q.high, cur)); text('low', price(q.low, cur)); text('prev', price(q.previousClose, cur));
    text('retrieved', new Date(d.retrievedAt).toLocaleString('ar-EG'));
    const change = $('change'); change.textContent = signed(q.change) + ' (' + signed(q.changePercent) + '%)';
    change.className = Number(q.change) >= 0 ? 'positive' : 'negative';
    el.market.classList.remove('hidden');
    lastReport = result.analysis || ''; el.analysis.textContent = lastReport; renderNews(d.news, d.newsPeriod); el.analysisPanel.classList.remove('hidden');
  } catch (e) { showError(e && e.message ? e.message : 'تعذّر إكمال التحليل.'); }
  finally { setBusy(false); }
}
el.form.addEventListener('submit', e => { e.preventDefault(); analyze(el.symbol.value); });
document.querySelectorAll('[data-symbol]').forEach(b => b.addEventListener('click', () => { el.symbol.value = b.dataset.symbol; analyze(b.dataset.symbol); }));
function openSettings() {
  el.settingsError.classList.add('hidden'); el.settingsSuccess.classList.add('hidden');
  el.finnKey.value = ''; el.harborKey.value = ''; el.modal.classList.remove('hidden');
  window.xkTrade.getSettings().then(s => {
    text('finnhubStatus', s.hasFinnhubKey ? 'مفتاح محفوظ محليًا' : 'لم يتم ضبط المفتاح');
    text('harborStatus', s.hasTokenHarborKey ? 'مفتاح محفوظ محليًا' : 'لم يتم ضبط المفتاح');
    el.style.value = s.style || 'balanced'; el.days.value = String(s.newsDays || 7); el.instructions.value = s.customInstructions || '';
  }).catch(e => { el.settingsError.textContent = e.message; el.settingsError.classList.remove('hidden'); });
}
$('settingsBtn').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', () => el.modal.classList.add('hidden'));
$('cancelSettings').addEventListener('click', () => el.modal.classList.add('hidden'));
el.modal.addEventListener('click', e => { if (e.target === el.modal) el.modal.classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') el.modal.classList.add('hidden'); });
el.settingsForm.addEventListener('submit', async e => {
  e.preventDefault(); $('saveSettings').disabled = true; el.settingsError.classList.add('hidden'); el.settingsSuccess.classList.add('hidden');
  try {
    const s = await window.xkTrade.saveSettings({
      finnhubApiKey: el.finnKey.value, tokenHarborApiKey: el.harborKey.value,
      style: el.style.value, newsDays: Number(el.days.value), customInstructions: el.instructions.value
    });
    el.finnKey.value = ''; el.harborKey.value = '';
    text('finnhubStatus', s.hasFinnhubKey ? 'مفتاح محفوظ محليًا' : 'لم يتم ضبط المفتاح');
    text('harborStatus', s.hasTokenHarborKey ? 'مفتاح محفوظ محليًا' : 'لم يتم ضبط المفتاح');
    el.settingsSuccess.textContent = 'تم الحفظ المشفّر على هذا الجهاز.'; el.settingsSuccess.classList.remove('hidden');
  } catch (err) { el.settingsError.textContent = err.message || 'تعذر حفظ الإعدادات.'; el.settingsError.classList.remove('hidden'); }
  finally { $('saveSettings').disabled = false; }
});
document.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', async () => {
  if (!confirm('هل تريد مسح هذا المفتاح المحفوظ؟')) return;
  try {
    const s = await window.xkTrade.clearKey(b.dataset.clear);
    text('finnhubStatus', s.hasFinnhubKey ? 'مفتاح محفوظ محليًا' : 'لم يتم ضبط المفتاح');
    text('harborStatus', s.hasTokenHarborKey ? 'مفتاح محفوظ محليًا' : 'لم يتم ضبط المفتاح');
    el.settingsSuccess.textContent = 'تم مسح المفتاح.'; el.settingsSuccess.classList.remove('hidden');
  } catch (err) { el.settingsError.textContent = err.message; el.settingsError.classList.remove('hidden'); }
}));
$('copyBtn').addEventListener('click', async () => {
  if (!lastReport) return;
  try { await navigator.clipboard.writeText(lastReport); $('copyBtn').textContent = 'تم النسخ ✓'; setTimeout(() => $('copyBtn').textContent = 'نسخ التقرير', 1600); }
  catch { showError('تعذر النسخ التلقائي. حدّد التقرير وانسخه يدويًا.'); }
});
(async () => {
  try { const s = await window.xkTrade.getSettings(); if (!s.hasFinnhubKey || !s.hasTokenHarborKey) setTimeout(openSettings, 300); }
  catch (e) { showError(e.message || 'تعذّر قراءة إعدادات التطبيق.'); }
})();
