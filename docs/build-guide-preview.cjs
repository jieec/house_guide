// Local visual preview of the real WXML/WXSS; fixture values are not production data.
// Run: node docs/build-guide-preview.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let page;
vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/guide/guide.js'), 'utf8'), {
  getApp: () => ({globalData: {}}), require: () => ({}), Page: p => {page = p},
  console, Date, setTimeout, clearTimeout
});
const doc = {
  community: '示例 · 云栖花园', province: '示例省', city: '示例市', district: '示例区',
  base: {propertyType: '住宅', completionTime: '2018', averageArea: 96, developer: '示例城市建设有限公司', propertyCompany: '示例物业服务有限公司', plotRatio: 2.1, greenRate: '35%', parking: '1:1.2'},
  price: {price: 28600, recentDealPrice: 27800, listingPrice: 30200, auctionPrice: 24300, rentPerSqm: 62, averageTotalPrice: 275, history: [{price: 28000}, {price: 28600}]},
  beike: {household_count: 1280, building_count: 12, property_fee: '2.8 元/㎡/月', avg_price: 28600},
  pois: {subway: [{name: '示例地铁站', dist: '650米'}], bus: [{name: '花园路公交站', dist: '180米'}], school: [{name: '示例实验学校', dist: '850米'}, {name: '社区幼儿园', dist: '320米'}]},
  nearComms: [{name: '示例 · 湖畔雅居', price: 31500, dist: 800}, {name: '示例 · 紫荆苑', price: 26800, dist: 1200}],
  deals: {count: 26, avg_unit_price: 27800, latest_date: '示例日期', recent: [{title: '3室2厅 · 96㎡', date: '2026-09-18', total_wan: 267, unit_price: 27813}, {title: '2室2厅 · 82㎡', date: '2026-08-26', total_wan: 228, unit_price: 27805}]}
};
page.data.loanForm.totalPrice = '275';
page.data.loanResult = page.calculateLoanResult(page.data.loanForm);
const report = page.buildReport(doc, {sales: [{unit_price: '30200', area_sqm: '96', total_price: '290万', rooms: '3室2厅'}], rents: [], auctionDeals: []}, {price: 25900, count: 120}, [], []);
const missingReport = page.buildReport({community: '示例 · 暂无数据小区'}, {sales: [], rents: [], auctionDeals: []}, {}, [], []);
const source = fs.readFileSync(path.join(root, 'pages/guide/guide.wxml'), 'utf8');
const tree = {children: []}, stack = [tree];
const tokens = source.match(/<!--[\s\S]*?-->|<\/?[\w-]+(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g);
for (const token of tokens) {
  if (token.startsWith('<!--')) continue;
  if (token.startsWith('</')) {
    const tag = token.slice(2, -1).trim();
    if (stack.length === 1 || stack.pop().tag !== tag) throw Error('Unbalanced WXML: ' + tag);
  } else if (token.startsWith('<')) {
    const tag = token.match(/^<([\w-]+)/)[1], attrs = {};
    for (const m of token.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    const node = {tag, attrs, children: []};
    stack[stack.length - 1].children.push(node);
    if (!token.endsWith('/>')) stack.push(node);
  } else stack[stack.length - 1].children.push(token);
}
if (stack.length !== 1) throw Error('Unclosed WXML');
const evaluate = (s, ctx) => Function('ctx', 'with(ctx){return (' + s + ')}')(ctx);
const raw = (s, ctx) => evaluate(s.replace(/^{{|}}$/g, ''), ctx);
const escape = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const interpolate = (s, ctx) => s.replace(/{{([\s\S]*?)}}/g, (_, expr) => escape(evaluate(expr, ctx)));
function children(nodes, ctx) {
  let output = '', matched = false;
  for (const n of nodes) {
    if (typeof n === 'string') {output += interpolate(n, ctx); continue;}
    const a = n.attrs;
    if ('wx:if' in a) {matched = !!raw(a['wx:if'], ctx); if (!matched) continue;}
    else if ('wx:elif' in a) {if (matched) continue; matched = !!raw(a['wx:elif'], ctx); if (!matched) continue;}
    else if (Object.hasOwn(a, 'wx:else')) {if (matched) continue; matched = true;}
    else matched = false;
    output += render(n, ctx);
  }
  return output;
}
function render(n, ctx) {
  const a = n.attrs;
  if (a['wx:for']) return (raw(a['wx:for'], ctx) || []).map((item, index) => {
    const attrs = {...a}; delete attrs['wx:for'];
    return render({...n, attrs}, {...ctx, [a['wx:for-item'] || 'item']: item, [a['wx:for-index'] || 'index']: index});
  }).join('');
  if (n.tag === 'block') return children(n.children, ctx);
  if (n.tag === 'canvas') return '';
  const tag = ({view: 'div', text: 'span', 'scroll-view': 'div', picker: 'div', image: 'img'})[n.tag] || n.tag;
  let attrs = '';
  for (const key of ['class', 'style', 'placeholder', 'value', 'type']) if (a[key]) attrs += ' ' + key + '="' + interpolate(a[key], ctx) + '"';
  if (a.src) attrs += ' src="' + a.src.replace(/^\/images\//, '../images/').replace('../../images/', '../images/') + '"';
  return '<' + tag + attrs + '>' + (['img', 'input'].includes(tag) ? '' : children(n.children, ctx) + '</' + tag + '>');
}
// The parser needs wx:else even though it has no assigned value.
// Reconcile element tokens with nodes in document order.
const elements = [];
(function walk(n) {for (const c of n.children) if (typeof c !== 'string') {elements.push(c); walk(c)}})(tree);
let ei = 0;
for (const t of tokens) if (/^<[\w-]/.test(t)) {if (/\swx:else(?:\s|>)/.test(t)) elements[ei].attrs['wx:else'] = ''; ei++;}
const cssFiles = ['styles/fonts.wxss', 'styles/habo-design.wxss', 'styles/components.wxss', 'styles/icons.wxss', 'app.wxss', 'pages/guide/guide.wxss'];
let css = cssFiles.map(f => fs.readFileSync(path.join(root, f), 'utf8').replace(/@import[^;]+;/g, '')).join('\n');
css = css.replace(/(-?[\d.]+)rpx/g, (_, v) => `calc(var(--rpx) * ${Number(v)})`).replace(/\bpage(?=\s*\{)/g, '.phone').replace(/\.price-bar-label text/g, '.price-bar-label span').replace(/\.score-tile-number text/g, '.score-tile-number span');
const states = ['基本信息', '价值分析', '购置建议', '工具使用', '缺失数据'];
const panes = states.map((name, i) => '<section class="pane" id="pane-' + i + '"' + (i ? ' hidden' : '') + '>' + children(tree.children, {...page.data, activeTab: i === 4 ? 0 : i, report: i === 4 ? missingReport : report, selectedCommunity: i === 4 ? {community:'示例 · 暂无数据小区'} : doc, location: doc, loading: false, dataStatus: '示例数据', updatedAt: '示例日期', expandedTool: 0, expandedAdvice: 'inv-0'}) + '</section>').join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小区报告 · 雾紫数据展示预览</title><style>${css}
:root{--rpx:min(0.133333vw,0.52px)}body{margin:0;background:#EDEAF5;font-family:'Microsoft YaHei',sans-serif}*{box-sizing:border-box}.preview-head{max-width:750px;margin:24px auto;padding:0 20px;color:#52467B}.preview-head p{font-size:13px;line-height:1.7}.preview-tabs{display:flex;flex-wrap:wrap;gap:8px}.preview-tabs button{font-size:13px;border:1px solid #D8D3EC;border-radius:20px;padding:8px 14px;background:white;color:#52467B;cursor:pointer}.preview-tabs button.active{background:#52467B;color:white}.phone{position:relative;max-width:390px;margin:24px auto;background:#F6F5FC;border-radius:28px;box-shadow:0 12px 50px #372c5718;overflow:hidden;min-height:800px}.global-fixed-bg{display:none}.animated{animation:none}.pane[hidden]{display:none}.phone .guide-main{padding-bottom:30px}.phone .tabs{pointer-events:none;overflow-x:auto}.pdf-canvas{display:none}.phone input{min-height:32px}.phone .ic{display:inline-block}.phone .price-bar-label span{display:block}.phone .score-tile-number span{font-size:12px;margin-left:4px}.phone .cat-card-body{display:block}
</style><div class="preview-head"><h2>小区报告 · 雾紫数据展示</h2><p>布局预览｜所有数字均为演示数据，不代表真实房产。复用当前 WXML / WXSS；小程序实际效果需在微信开发者工具验证。</p><nav class="preview-tabs">${states.map((n,i)=>`<button class="${i===0?'active':''}" onclick="selectPane(${i},this)">${n}</button>`).join('')}</nav></div><main class="phone">${panes}</main><script>function selectPane(i,b){document.querySelectorAll('.pane').forEach((p,j)=>p.hidden=i!==j);document.querySelectorAll('.preview-tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active')}</script></html>`;
fs.writeFileSync(path.join(__dirname, 'guide-dashboard-preview.html'), html);
console.log('WXML balanced; populated and missing-data views rendered. Preview: docs/guide-dashboard-preview.html');
