// app.js — Token Launch Radar dashboard, model radar-3.0.
// Reads window.RADAR (written by main.ts beside this page) and renders
// the board, the detail view, the filters and the live comparables.
// No network: every byte comes from data.js. The implied value is
// recomputed here from the same figures with the same V3 formula, so
// the page and board.json agree exactly.
'use strict';
var R = window.RADAR;
var SCALE_K = 3640, TVL_EXP = 0.45, STR = 0.25;
var FLAG_LABEL = { f: 'Falling TVL', y: 'Young', u: 'Age unknown', s: 'Single chain' };

function round4(x) { return Math.round(x * 10000) / 10000; }
function catMult(c) {
  if (c === 'Dexs' || c === 'Lending' || c === 'Risk Curators' || c === 'Onchain Capital Allocator') return 1.10;
  if (c === 'Yield' || c === 'RWA' || c === 'CDP' || c === 'Derivatives' || c === 'Restaking' || c === 'Yield Aggregator') return 1.05;
  if (c === 'Chain' || c === 'Payments' || c === 'Stablecoin Wrapper') return 0.90;
  return 1.00;
}
// Effective multipliers and implied value for one compact row:
// [slug, name, category, chainCount, firstChain, tvl, change7d, ageDays,
//  implied, growth, maturity, category, chains, flags, watchlist]
function eff(row) {
  var g = row[6] === null ? 0 : Math.min(120, Math.max(-60, row[6]));
  var gm = 1 + (g / 100) * 0.6;
  var age = row[7] === null ? 365 : row[7];
  var mm = 0.7 + (Math.min(age, 730) / 730) * 0.3;
  var cm = catMult(row[2]);
  var chm = 1 + Math.min(Math.max(row[3] - 1, 0), 4) * 0.025;
  return { growth: round4(Math.pow(gm, STR)), maturity: round4(Math.pow(mm, STR)), category: round4(Math.pow(cm, STR)), chains: round4(Math.pow(chm, STR)) };
}
function implied(row) {
  var m = eff(row);
  return Math.max(1, Math.round(SCALE_K * Math.pow(row[5], TVL_EXP) * m.growth * m.maturity * m.category * m.chains));
}
function categoryAction(c) {
  switch (c) {
    case 'Dexs': return 'swap and provide liquidity';
    case 'Lending': return 'lend and borrow';
    case 'Yield': return 'deposit into yield vaults';
    case 'Yield Aggregator': return 'deposit into aggregated vaults';
    case 'RWA': return 'buy tokenised real-world assets';
    case 'CDP': return 'mint stablecoins against collateral';
    case 'Derivatives': return 'open derivatives positions';
    case 'Restaking': return 'restake assets';
    case 'Risk Curators': return 'deposit into curated vaults';
    case 'Onchain Capital Allocator': return 'allocate into managed vaults';
    case 'Chain': return 'bridge in and use the chain apps';
    case 'Payments': return 'use the payment rails';
    case 'Stablecoin Wrapper': return 'wrap and unwrap stablecoins';
    default: return 'use the protocol';
  }
}
// The six farm steps — the same templates the board's farm_steps use,
// so the page shows exactly the steps the board carries.
function farmSteps(row) {
  var name = row[1];
  var chain = row[4] || 'its main chain';
  var action = categoryAction(row[2]);
  var category = row[2] || 'DeFi';
  return [
    'Set up a fresh wallet for ' + name + ' on ' + chain + ' and bridge in funds you can afford to leave for weeks. Bridging costs a few dollars in gas and takes about 10 minutes.',
    'Make a first ' + action + ' position on ' + name + ' (' + chain + ') with a few hundred dollars, so you learn the flow before sizing up. About 15 minutes plus gas.',
    'Add a second position in a different ' + category + ' pool or feature of ' + name + ' and leave both open: launches usually reward depth and time, not one-off clicks. 15 to 30 minutes.',
    'Come back once a week and make one real on-chain action on ' + name + ' — a top-up, a swap or a claim — so the address stays active across weeks. About 10 minutes a week.',
    'Check ' + name + '\'s own announcements for a points program or quests and do only the tasks the protocol itself publishes. Never pay anyone for a whitelist spot.',
    'Keep a simple log of every deposit with dates and amounts, and never deposit more than you can lose. Exit promptly if ' + name + '\'s TVL falls sharply two weeks in a row.'
  ];
}
function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function rankChip(rank) {
  var cls = rank === 1 ? 'm1' : rank === 2 ? 'm2' : rank === 3 ? 'm3' : rank <= 10 ? 'mtop' : '';
  return '<span class="rank ' + cls + '">' + rank + '</span>';
}
function driverBars(m) {
  var parts = [['Growth', m.growth], ['Maturity', m.maturity], ['Category', m.category], ['Chains', m.chains]];
  return '<div class="drivers">' + parts.map(function (p) {
    var w = Math.max(0, Math.min(100, ((p[1] - 0.85) / 0.30) * 100));
    return '<div class="drv"><i>' + p[0] + '</i><span class="bar"><b style="width:' + w.toFixed(0) + '%"></b></span><b class="v">' + p[1].toFixed(4) + '</b></div>';
  }).join('') + '</div>';
}
function flagChips(flags) {
  return flags.split('').map(function (f) { return '<span class="flag">' + esc(FLAG_LABEL[f] || f) + '</span>'; }).join('');
}

// ---------------------------------------------------------------- rendering

var rows = R.rows.slice();
var bySlug = {};
rows.forEach(function (r) { bySlug[r[0]] = r; });
var current = null;

function rowAge(r) { return r[7] === null ? 'unknown' : r[7] + 'd'; }
function rowGrowth(r) { return r[6] === null ? '—' : (r[6] >= 0 ? '+' : '') + r[6].toFixed(1) + '%'; }

function renderSpotlight() {
  var top = rows.slice(0, 3);
  document.getElementById('spot-cards').innerHTML = top.map(function (r, i) {
    return '<div class="spot" data-slug="' + esc(r[0]) + '"><h3>' + rankChip(i + 1) + ' ' + esc(r[1]) + '</h3>' +
      '<div class="big">' + money(implied(r)) + '</div>' +
      '<div class="meta">' + esc(r[2] || 'Uncategorised') + ' · TVL ' + money(r[5]) + ' · 7d ' + rowGrowth(r) + ' · age ' + rowAge(r) + '</div>' +
      driverBars(eff(r)) + '</div>';
  }).join('');
}

function filteredRows() {
  var q = document.getElementById('q').value.trim().toLowerCase();
  var risk = document.getElementById('risk').value;
  var sort = document.getElementById('sort').value;
  var list = rows.filter(function (r) {
    if (risk && r[13].indexOf(risk) < 0) return false;
    if (q && (r[0] + ' ' + r[1] + ' ' + (r[2] || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  if (sort === 'tvl') list.sort(function (a, b) { return b[5] - a[5]; });
  else if (sort === 'growth') list.sort(function (a, b) { return (b[6] || 0) - (a[6] || 0); });
  else if (sort === 'age') list.sort(function (a, b) { return (b[7] === null ? 99999 : b[7]) - (a[7] === null ? 99999 : a[7]); });
  else list.sort(function (a, b) { return implied(b) - implied(a); });
  return list;
}

function renderBoard() {
  var list = filteredRows();
  document.getElementById('count').textContent = list.length + ' of ' + rows.length + ' protocols';
  document.getElementById('rows').innerHTML = list.map(function (r) {
    var rank = rows.indexOf(r) + 1;
    var m = eff(r);
    return '<tr data-slug="' + esc(r[0]) + '"><td>' + rankChip(rank) + '</td>' +
      '<td><span class="name">' + esc(r[1]) + '</span>' + (r[14] ? '<span class="wl">watchlist</span>' : '') + '<br><span class="sub">' + esc(r[0]) + '</span></td>' +
      '<td>' + esc(r[2] || '—') + '</td><td class="num">' + r[3] + '</td>' +
      '<td class="num">' + money(r[5]) + '</td><td class="num">' + rowGrowth(r) + '</td><td class="num">' + rowAge(r) + '</td>' +
      '<td class="num"><strong>' + money(implied(r)) + '</strong></td>' +
      '<td>' + driverBars(m) + '</td><td>' + flagChips(r[13]) + '</td></tr>';
  }).join('');
}

function renderDetail(slug) {
  var r = bySlug[slug];
  if (!r) return;
  current = slug;
  var rank = rows.indexOf(r) + 1;
  var m = eff(r);
  var v = implied(r);
  var steps = farmSteps(r);
  document.getElementById('detail').innerHTML =
    '<h2>' + rankChip(rank) + ' ' + esc(r[1]) + ' <span class="sub">— ' + esc(r[0]) + '</span></h2>' +
    '<div class="big">' + money(v) + ' implied value</div>' +
    '<div class="grid">' +
    '<div><strong>TVL</strong> ' + money(r[5]) + '</div><div><strong>7-day change</strong> ' + rowGrowth(r) + '</div>' +
    '<div><strong>Age</strong> ' + rowAge(r) + '</div><div><strong>Category</strong> ' + esc(r[2] || '—') + '</div>' +
    '<div><strong>Chains</strong> ' + r[3] + ' (' + esc(r[4] || '—') + ' first)</div><div><strong>Risk</strong> ' + (flagChips(r[13]) || 'none flagged') + '</div>' +
    '</div>' + driverBars(m) +
    '<div class="modelblock">model radar-3.0\n' +
    'implied = round(3640 × TVL^0.45 × ' + m.growth.toFixed(4) + ' × ' + m.maturity.toFixed(4) + ' × ' + m.category.toFixed(4) + ' × ' + m.chains.toFixed(4) + ') = ' + money(v) + '\n' +
    'growth, maturity, category and chains are the V2 multipliers at quarter strength.</div>' +
    '<h3>How to farm it</h3><ol>' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
}

function renderLive() {
  document.getElementById('live-rows').innerHTML = R.live.map(function (l) {
    var ratio = l[4] / l[3];
    return '<tr><td><span class="name">' + esc(l[1]) + '</span><br><span class="sub">' + esc(l[0]) + '</span></td>' +
      '<td class="num">' + money(l[2]) + '</td><td class="num">' + money(l[3]) + '</td>' +
      '<td class="num">' + money(l[4]) + '</td><td class="num">' + ratio.toFixed(2) + '×</td></tr>';
  }).join('');
}

// ---------------------------------------------------------------- events

function openDetail(slug) {
  renderDetail(slug);
  document.getElementById('detail').scrollIntoView();
}
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-slug]');
  if (t) openDetail(t.getAttribute('data-slug'));
});
['q', 'risk', 'sort'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', renderBoard);
});
window.addEventListener('hashchange', applyHash);
function applyHash() {
  var h = location.hash || '';
  if (h.indexOf('#detail-') === 0) { renderDetail(h.slice(8)); return; }
  if (h.indexOf('#risk-') === 0) {
    var map = { falling: 'f', young: 'y', single: 's', unknown: 'u' };
    document.getElementById('risk').value = map[h.slice(6)] || '';
    renderBoard();
    document.getElementById('detail').innerHTML = '';
  }
}

// ---------------------------------------------------------------- init

renderSpotlight();
renderBoard();
renderLive();
if (location.hash) applyHash();
else renderDetail(rows[0][0]);
