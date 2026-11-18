// Token Radar dashboard, radar-2.1. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table,
// a per-protocol detail view with the model's own five factors and the
// protocol's farm plan, and a live-token view. No network: every byte it
// shows is in data.js. No address is named anywhere in this page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', risk: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  // The exact figure behind an abbreviated one: `$1,234,567,890`. Used
  // as the hover text of every abbreviated amount, so a reader can see
  // the full number without the table growing a column for it.
  function fmtUsdExact(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // Risk flags, recomputed here only when a row arrives without them:
  // the board's own risk array (from lib/model.ts riskFlags) is the
  // source of truth, and this mirror exists so an older data.js, or a
  // row pasted in by hand, still shows the same warnings. The cutoffs
  // are the model's own: one chain, under 180 days, a seven-day fall
  // past -20% or a rise past +50%, TVL at $5B or under $10M, and an
  // age of three years with no token, or no age at all.
  var RISK_CUTOFFS = { veryYoungDays: 180, fallingFastPct: -20, surgingPct: 50, hugeTvlUsd: 5e9, tinyTvlUsd: 1e7, longNoTokenDays: 1095 };
  function riskFlagsFor(row) {
    if (row.risk && Array.isArray(row.risk)) return row.risk.slice();
    var flags = [];
    var chains = row.chains || [];
    if (chains.length === 0) flags.push('no-chain-data');
    else if (chains.length === 1) flags.push('single-chain');
    var age = row.age_days === null || row.age_days === undefined ? null : row.age_days;
    if (age === null) flags.push('unknown-age');
    else if (age < RISK_CUTOFFS.veryYoungDays) flags.push('very-young');
    else if (age >= RISK_CUTOFFS.longNoTokenDays) flags.push('long-no-token');
    if (row.change_7d === null || row.change_7d === undefined) flags.push('no-growth-data');
    else if (row.change_7d < RISK_CUTOFFS.fallingFastPct) flags.push('falling-fast');
    else if (row.change_7d > RISK_CUTOFFS.surgingPct) flags.push('surging');
    if (row.tvl_usd >= RISK_CUTOFFS.hugeTvlUsd) flags.push('huge-tvl');
    else if (row.tvl_usd < RISK_CUTOFFS.tinyTvlUsd) flags.push('tiny-tvl');
    return flags;
  }
  function riskLabel(flag) {
    var labels = {
      'no-chain-data': 'No chain data',
      'single-chain': 'Single chain',
      'very-young': 'Very young',
      'unknown-age': 'Unknown age',
      'long-no-token': 'Long wait, no token',
      'falling-fast': 'Falling fast',
      'surging': 'Surging',
      'huge-tvl': 'Huge TVL',
      'tiny-tvl': 'Tiny TVL',
      'no-growth-data': 'No growth data'
    };
    return labels[flag] || flag;
  }
  function riskExplanation(flag) {
    var notes = {
      'no-chain-data': 'The snapshot lists no chain, so where it runs is unknown.',
      'single-chain': 'One chain carries all of the exposure.',
      'very-young': 'Listed under 180 days ago, so there is little history to judge it by.',
      'unknown-age': 'No listing date is recorded, so its age is estimated, not measured.',
      'long-no-token': 'Listed for three years or more with no token, so a token may never come.',
      'falling-fast': 'TVL fell more than 20% in the last seven days.',
      'surging': 'TVL rose more than 50% in the last seven days, which is often hot money.',
      'huge-tvl': 'TVL is $5B or more, so the implied value is concentrated in one large name.',
      'tiny-tvl': 'TVL is under $10M, so exits can be thin and slippage is a real cost.',
      'no-growth-data': 'No seven-day TVL change was reported, so recent momentum is unknown.'
    };
    return notes[flag] || 'An unusual figure in this protocol’s snapshot record.';
  }
  function riskLevelFor(flags) {
    if (!flags || flags.length === 0) return 'clean';
    if (flags.length >= 3 || flags.indexOf('falling-fast') >= 0) return 'high';
    return 'watch';
  }
  // One number for sorting by risk: the level first, then how many flags
  // the row carries, so the riskiest rows sort to the top of the board.
  function riskScore(row) {
    var flags = riskFlagsFor(row);
    var level = riskLevelFor(flags);
    return (level === 'high' ? 3 : level === 'watch' ? 2 : 1) * 10 + flags.length;
  }
  function riskBadges(row) {
    var flags = riskFlagsFor(row);
    if (flags.length === 0) return el('span', { class: 'risk risk-clean', text: 'No flags' });
    var level = riskLevelFor(flags);
    var wrap = el('span', { class: 'risk-flags risk-' + level });
    flags.forEach(function (flag) {
      wrap.appendChild(el('span', { class: 'risk-badge', title: riskExplanation(flag), text: riskLabel(flag) }));
    });
    return wrap;
  }

  // CSV export: the board the reader is actually looking at — the current
  // search, category, chain and scope filters, in the current sort order —
  // as a plain CSV file, so it opens in any spreadsheet without a network
  // call. A field that holds a comma, a quote or a line break is wrapped
  // in double quotes and its quotes are doubled, which is the CSV rule.
  function csvEscape(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }
  function boardCsv(list) {
    var header = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'implied_value_usd', 'risk'];
    var lines = [header.join(',')];
    list.forEach(function (r) {
      lines.push([
        r.rank,
        csvEscape(r.slug),
        csvEscape(r.name),
        csvEscape(r.category || ''),
        csvEscape((r.chains || []).join('; ')),
        r.tvl_usd,
        r.implied_value_usd,
        csvEscape(riskFlagsFor(r).join('; '))
      ].join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }
  function downloadBoardCsv() {
    var list = sortedRows(rows());
    var blob = new Blob([boardCsv(list)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'token-radar-board.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return list.length;
  }

  // Copying text to the clipboard: the modern clipboard API first, and
  // the old hidden-textarea selection trick when the API is missing or
  // refuses, so the button works in older browsers too. It resolves to
  // true when the text landed on the clipboard, false when it did not.
  function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return copyWithTextarea(text); });
    }
    return Promise.resolve(copyWithTextarea(text));
  }
  function copyWithTextarea(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    document.body.removeChild(area);
    return done;
  }
  function farmPlanText(row, steps) {
    var lines = [];
    lines.push(row.name + ' — farm plan (Token Radar, rank ' + row.rank + ')');
    lines.push('Implied value ' + fmtUsd(row.implied_value_usd) + ' on TVL ' + fmtUsd(row.tvl_usd) + '.');
    steps.forEach(function (step, i) { lines.push((i + 1) + '. ' + step); });
    lines.push('Flags to watch: ' + (riskFlagsFor(row).join(', ') || 'none') + '.');
    return lines.join('\n');
  }
  function copyFarmPlan(row, steps, button) {
    var original = button.textContent;
    copyTextToClipboard(farmPlanText(row, steps)).then(function (done) {
      button.textContent = done ? 'Copied!' : 'Copy failed — select the steps';
      button.disabled = true;
      window.setTimeout(function () { button.textContent = original; button.disabled = false; }, 2000);
    });
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code
  // and the board's data are visibly the same arithmetic.
  function categoryMultiplier(category) {
    if (category === 'Dexs' || category === 'Lending' || category === 'Risk Curators' || category === 'Onchain Capital Allocator') return 1.1;
    if (category === 'Yield' || category === 'RWA' || category === 'CDP' || category === 'Derivatives' || category === 'Restaking' || category === 'Yield Aggregator') return 1.05;
    if (category === 'Chain' || category === 'Payments' || category === 'Stablecoin Wrapper') return 0.9;
    return 1.0;
  }
  function chainMultiplier(chains) {
    return 1 + Math.min(Math.max((chains || []).length - 1, 0), 4) * 0.025;
  }
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * categoryMultiplier(row.category) * chainMultiplier(row.chains)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('payment') >= 0) return 'Use ' + name + ' on ' + chain + ' to move $' + capital + ' and keep a record of the payment.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and check the protocol\'s own points page.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, and never pay to claim.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and unwind if the TVL falls by half in a week or the token launches.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // What drives one row's score, in plain words: the strongest factor
  // above 1.0 is named first, and any factor pulling the score down is
  // named after it, so the reader sees why this row sits where it does.
  function driverSentence(row) {
    var ups = [
      ['seven-day growth', row.growth_multiplier],
      ['maturity', row.maturity_multiplier],
      ['category', row.category_multiplier],
      ['chain reach', row.chain_multiplier]
    ].filter(function (d) { return d[1] > 1; }).sort(function (a, b) { return b[1] - a[1]; });
    var downs = [
      ['seven-day growth', row.growth_multiplier],
      ['maturity', row.maturity_multiplier],
      ['category', row.category_multiplier]
    ].filter(function (d) { return d[1] < 1; }).sort(function (a, b) { return a[1] - b[1]; });
    var text = ups.length === 0
      ? 'No factor lifts this score above its TVL base: the implied value is the base alone.'
      : 'The biggest lift is ' + ups[0][0] + ' (x' + ups[0][1] + ').';
    if (downs.length > 0) text += ' ' + downs[0][0][0].toUpperCase() + downs[0][0].slice(1) + ' pulls it back (x' + downs[0][1] + ').';
    return text;
  }
  // One factor as a labelled bar: how far its multiplier sits from 1.0,
  // up in green or down in red, on a scale of 0.8 either way.
  function factorBar(label, mult) {
    var delta = mult - 1;
    var width = Math.min(100, Math.round(Math.abs(delta) / 0.8 * 100));
    return el('div', { class: 'factor-row' },
      el('span', { class: 'factor-label', text: label }),
      el('div', { class: 'factor-track' }, el('i', { class: 'factor-fill ' + (delta >= 0 ? 'up' : 'down'), style: 'width:' + Math.max(delta === 0 ? 0 : 3, width) + '%' })),
      el('span', { class: 'num factor-value ' + (delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''), text: 'x' + mult })
    );
  }
  function factorBars(row) {
    var base = Math.max(1, Math.round(row.tvl_usd * DATA.model.base_multiple));
    return el('div', { class: 'factor-bars' },
      el('div', { class: 'factor-row' },
        el('span', { class: 'factor-label', text: 'Base (TVL x 0.25)' }),
        el('div', { class: 'factor-track' }, el('i', { class: 'factor-fill base', style: 'width:100%' })),
        el('span', { class: 'num factor-value', text: fmtUsd(base) })
      ),
      factorBar('Growth', row.growth_multiplier),
      factorBar('Maturity', row.maturity_multiplier),
      factorBar('Category', row.category_multiplier),
      factorBar('Chain reach', row.chain_multiplier)
    );
  }
  function riskLevelPill(level) {
    return el('span', { class: 'risk-level risk-level-' + level, text: level === 'clean' ? 'No flags' : level === 'high' ? 'High risk' : 'Watch' });
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('risk')) state.risk = params.get('risk');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.risk !== 'all') params.set('risk', state.risk);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.scope === 'early' && r.tvl_usd >= DATA.floor_usd) return false;
      if (state.scope === 'watchlist' && r.tvl_usd < DATA.floor_usd) return false;
      if (state.risk !== 'all' && riskLevelFor(riskFlagsFor(r)) !== state.risk) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'risk') { av = riskScore(a); bv = riskScore(b); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' clean pre-token protocols below that floor, every one of them, not just the largest. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 3);
    return el('section', { class: 'spot' },
      top.map(function (r) {
        return el('article', { class: 'spot-card' + (r.rank === 1 ? ' spot-first' : ''), tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter') openDetail(r.slug); } },
          el('div', { class: 'spot-top' },
            el('span', { class: 'spot-rank', text: '#' + r.rank }),
            r.rank === 1 ? el('span', { class: 'spot-tag', text: 'Top pick' }) : null
          ),
          el('h2', { text: r.name }),
          el('p', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('div', { class: 'spot-num' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(r.implied_value_usd), title: fmtUsdExact(r.implied_value_usd) })),
          el('div', { class: 'spot-num' }, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(r.tvl_usd), title: fmtUsdExact(r.tvl_usd) })),
          el('div', { class: 'spot-num' }, el('span', { text: '7-day growth' }), el('b', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })),
          el('div', { class: 'spot-risk' }, riskBadges(r))
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var sc = el('select', { id: 'scope', 'aria-label': 'Filter by scope' },
      el('option', { value: 'all', text: 'Watchlist + early' }),
      el('option', { value: 'watchlist', text: 'Watchlist only', selected: state.scope === 'watchlist' ? 'selected' : null }),
      el('option', { value: 'early', text: 'Early (below floor) only', selected: state.scope === 'early' ? 'selected' : null })
    );
    sc.addEventListener('change', function () { state.scope = sc.value; writeHash(); render(); });
    var rk = el('select', { id: 'risk', 'aria-label': 'Filter by risk level' },
      el('option', { value: 'all', text: 'All risk levels' }),
      el('option', { value: 'clean', text: 'No flags', selected: state.risk === 'clean' ? 'selected' : null }),
      el('option', { value: 'watch', text: 'Watch', selected: state.risk === 'watch' ? 'selected' : null }),
      el('option', { value: 'high', text: 'High risk', selected: state.risk === 'high' ? 'selected' : null })
    );
    rk.addEventListener('change', function () { state.risk = rk.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'scope', text: 'Scope' }), sc),
      el('div', { class: 'field' }, el('label', { for: 'risk', text: 'Risk' }), rk),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Export the filtered board' }),
        el('button', {
          class: 'button csv-button', type: 'button', text: 'Download CSV',
          onclick: function () { downloadBoardCsv(); },
          title: 'Save the rows you are looking at — search, filters and sort included — as token-radar-board.csv'
        })),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    // The bar scale is the board's own top value, never the filtered
    // list's, so a bar means the same thing under every filter.
    var max = DATA.rows.length > 0 ? DATA.rows[0].implied_value_usd : 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var level = riskLevelFor(riskFlagsFor(r));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'data-top10': r.rank <= 10 ? 'true' : 'false',
        'data-risk': level,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank-cell' }, el('span', { class: 'rank-chip' + (r.rank <= 3 ? ' rank-top3' : r.rank <= 10 ? ' rank-top10' : ''), text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd), title: fmtUsdExact(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true', title: fmtUsdExact(r.implied_value_usd) }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd), title: fmtUsdExact(r.implied_value_usd) })
        )),
        el('td', null, riskBadges(r)),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    // What the reader is looking at, in risk terms: the counts behind
    // the badges, so a filtered view states its own risk mix at a glance.
    var counts = { clean: 0, watch: 0, high: 0 };
    list.forEach(function (r) { counts[riskLevelFor(riskFlagsFor(r))]++; });
    return el('div', null,
      el('div', { class: 'panel' },
        el('div', { class: 'risk-summary' },
          el('span', null, 'Showing ', el('b', { text: String(list.length) }), ' rows — '),
          el('b', { class: 'risk-count-high', text: String(counts.high) }),
          el('span', null, ' high risk, '),
          el('b', { text: String(counts.watch) }),
          el('span', null, ' watch, '),
          el('b', { text: String(counts.clean) }),
          el('span', null, ' no flags.')
        ),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
            el('thead', null, el('tr', null,
              sortHeader('implied', 'Rank'),
              sortHeader('name', 'Protocol'),
              sortHeader('tvl', 'TVL'),
              sortHeader('growth', '7d'),
              sortHeader('age', 'Age'),
              sortHeader('implied', 'Implied value'),
              sortHeader('risk', 'Risk'),
              el('th', { scope: 'col', text: 'Token' })
            )),
            tbody
          )
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x category x chains )'
      ),
      el('div', { class: 'factor' },
        el('span', { text: 'Category: Dexs, Lending, Risk Curators, Onchain Capital Allocators x1.10; Yield, RWA, CDP, Derivatives, Restaking, Yield Aggregators x1.05; Chain, Payments, Stablecoin Wrappers x0.90; all others x1.00.' }),
        el('span', { text: 'Chains: x(1 + min(chains - 1, 4) x 0.025), at most x1.10 for five or more chains.' })
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Wrapped, staked and bridged products are left out entirely, because their token already trades. The early radar is every clean pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Category multiplier' }), el('b', { class: 'num', text: String(row.category_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'What drives this score' }),
      el('p', { class: 'sub', text: driverSentence(row) }),
      factorBars(row)
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('div', { class: 'section-head' },
        el('h3', { text: 'What to watch' }),
        riskLevelPill(riskLevelFor(riskFlagsFor(row)))
      ),
      el('div', { class: 'risk-detail' }, riskBadges(row)),
      el('p', { class: 'sub', text: 'Risk level: ' + riskLevelFor(riskFlagsFor(row)) + '. ' + (riskFlagsFor(row).length === 0 ? 'Nothing in the snapshot figures stands out for this protocol.' : 'These flags come from the snapshot figures alone — chains, age, seven-day TVL change and TVL size — and they never change the implied value above.') }),
      el('ul', { class: 'risk-notes' }, riskFlagsFor(row).map(function (flag) {
        return el('li', null, el('b', { text: riskLabel(flag) + ': ' }), riskExplanation(flag));
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('button', {
        class: 'button copy-button', type: 'button', text: 'Copy farm plan',
        onclick: function (e) { copyFarmPlan(row, steps, e.currentTarget); },
        title: 'Copy this protocol’s six farm steps, with its implied value and risk flags, to the clipboard'
      })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
