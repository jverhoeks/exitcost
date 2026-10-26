// ExitCost calculator. All prices live in prices.js; this file only does maths and rendering.
(function () {
    const P = window.PRICES;
    const SIZES = ['S', 'M', 'L', 'XL'];
    const SIZE_KEYS = { S: 'vmS', M: 'vmM', L: 'vmL', XL: 'vmXL' };
    const HOURS = 730;

    // A price is either a number or { v, unverified, note }.
    const val = (p) => (p == null ? null : typeof p === 'number' ? p : p.v);
    const unv = (p) => !!(p && typeof p === 'object' && p.unverified);

    // ---------- State: inputs <-> URL ----------
    const inputs = [...document.querySelectorAll('[data-key]')];

    function renderServiceChips() {
        const box = document.getElementById('serviceChips');
        box.innerHTML = P.services.map((s) =>
            `<label class="chip"><input type="checkbox" data-svc="${s.key}"><span>${s.label}</span></label>`
        ).join('');
    }

    function readState() {
        const s = {};
        for (const el of inputs) {
            const k = el.dataset.key;
            if (el.type === 'checkbox') s[k] = el.checked;
            else if (el.type === 'number') s[k] = Math.max(0, parseFloat(el.value) || 0);
            else s[k] = el.value;
        }
        s.services = [...document.querySelectorAll('[data-svc]:checked')].map((el) => el.dataset.svc);
        return s;
    }

    function stateToQuery(s) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(s)) {
            if (k === 'services') { if (v.length) q.set('svc', v.join(',')); }
            else if (typeof v === 'boolean') q.set(k, v ? '1' : '0');
            else q.set(k, v);
        }
        return q.toString();
    }

    function loadFromQuery() {
        const q = new URLSearchParams(location.search);
        for (const el of inputs) {
            const k = el.dataset.key;
            if (!q.has(k)) continue;
            if (el.type === 'checkbox') el.checked = q.get(k) === '1';
            else el.value = q.get(k);
        }
        const svc = (q.get('svc') || '').split(',');
        document.querySelectorAll('[data-svc]').forEach((el) => { el.checked = svc.includes(el.dataset.svc); });
    }

    // ---------- Money ----------
    let CUR = 'EUR';
    let FX = P.fxEurUsd; // USD per EUR
    function toDisplay(amount, from) {
        if (from === CUR) return amount;
        return from === 'USD' ? amount / FX : amount * FX;
    }
    function fmt(amount, digits = 0) {
        return new Intl.NumberFormat('en-IE', {
            style: 'currency', currency: CUR, maximumFractionDigits: digits, minimumFractionDigits: digits
        }).format(amount);
    }

    function fmtShort(amount) {
        return new Intl.NumberFormat('en-IE', {
            style: 'currency', currency: CUR, notation: 'compact', maximumFractionDigits: Math.abs(amount) < 1000 ? 0 : 1
        }).format(amount);
    }

    // ---------- 01 Exit: egress ----------
    function tieredCost(tiers, gb) {
        let cost = 0, prevGB = 0;
        for (const t of tiers) {
            if (gb <= prevGB) break;
            const capGB = t.upToGB;
            cost += (Math.min(gb, capGB) - prevGB) * t.perGB;
            prevGB = capGB;
        }
        return cost;
    }

    const OBJECT_MB = { small: 1, medium: 100, large: 1024 };

    function lineGBps(s) {
        const overhead = s.objectSize === 'small' ? 0.9 : 0.95;
        return s.speed * (Math.min(s.availability, 100) / 100) * 0.125 * overhead;
    }

    // Ways to move all bucket data (step 01 plus step 02) out. Costs are transfer charges only, in USD.
    function calcRoutes(s) {
        const T = P.transfer;
        const cfg = P.egress[s.cloud];
        const tiers = cfg.regions[s.region].tiers;
        const tb = s.dataTB + (s.dp !== 'none' ? s.dpTB : 0);
        const gb = tb * 1024;
        const egress = tieredCost(tiers, gb);
        const gbps = lineGBps(s);
        const routes = {};
        routes.internet = {
            available: true, label: `Public internet at ${s.speed} Gbps`, waiver: true,
            readyWeeks: 0, hours: gbps > 0 ? gb / gbps / 3600 : Infinity,
            cost: s.waiver ? 0 : egress, strike: s.waiver ? egress : null,
        };
        const linkGBps = T.linkGbps * 0.125 * T.linkUtilisation;
        const linkHours = gb / linkGBps / 3600;
        const months = Math.max(1, Math.ceil(linkHours / 730));
        const fixed = val(T.crossConnect) + val(T.euSide);
        const best = T.links[s.cloud]
            .map((l) => ({ ...l, cost: months * (val(l.monthly) + fixed) + gb * val(l.perGB) + val(T.euSideSetup) }))
            .reduce((a, b) => (b.cost < a.cost ? b : a));
        routes.link = {
            available: true, label: `${best.label}, to your own data centre`, waiver: false, unverified: true,
            readyWeeks: val(T.leadWeeks), hours: linkHours, cost: best.cost,
            note: `${months} month${months === 1 ? '' : 's'} of port, cross-connect and EU-side line, plus per-GB charges. Only for a move to your own data centre or colo rack: Hetzner, Scaleway and most EU clouds offer no direct line, so for them use the internet. The leaving programme does not cover private lines.`,
        };
        const D = T.devices[s.cloud];
        if (D.available) {
            const n = Math.max(1, Math.ceil(tb / D.deviceTB));
            routes.device = {
                available: true, label: `${D.label}: ${n} device${n === 1 ? '' : 's'}`, waiver: false, unverified: true,
                readyWeeks: 0, hours: val(D.turnaroundDays) * 24, cost: n * D.deviceFee + egress, note: D.text,
            };
        } else {
            routes.device = { available: false, label: 'Shipped device', note: D.text };
        }
        const chosen = routes[s.route] && routes[s.route].available ? s.route : 'internet';
        return { routes, chosen, tb, currency: cfg.currency };
    }

    function calcExit(s, rt) {
        const cfg = P.egress[s.cloud];
        const region = cfg.regions[s.region];
        const gb = s.dataTB * 1024;
        const egress = tieredCost(region.tiers, gb);
        const requests = gb * 1024 / OBJECT_MB[s.objectSize];
        const api = requests * val(cfg.requestPrice);
        const gbPerSec = lineGBps(s);
        const viaInternet = rt.chosen === 'internet';
        const r = rt.routes[rt.chosen];
        // Another route carries all data from steps 01 and 02: its cost and time are booked here once.
        const hours = viaInternet ? (gbPerSec > 0 ? gb / gbPerSec / 3600 : Infinity) : r.readyWeeks * 168 + r.hours;
        const egressCharged = viaInternet ? (s.waiver ? 0 : egress) : r.cost;

        return {
            currency: cfg.currency, egress, api, hours, gbPerSec, viaInternet, route: r, chosen: rt.chosen,
            egressCharged,
            total: egressCharged + api,
            unverified: unv(region) || unv(cfg.requestPrice), cfg
        };
    }

    function durationText(h) {
        if (!isFinite(h)) return '—';
        if (h < 1) return `${Math.round(h * 60)} minutes`;
        if (h <= 48) return `${h.toFixed(1)} hours`;
        return `${(h / 24).toFixed(1)} days`;
    }

    function renderExit(s, r) {
        document.getElementById('waiverNote').innerHTML =
            `${r.cfg.waiver.text} <a href="${r.cfg.waiver.url}" target="_blank" rel="noopener">Terms</a>.`;
        const d = (x) => fmt(toDisplay(x, r.currency), 2);
        const egressCell = s.waiver
            ? `<span class="strike">${d(r.egress)}</span>${d(0)}`
            : d(r.egress);
        const moveRows = r.viaInternet ? `
            <div class="row"><span>Transfer time at ${s.speed} Gbps, ${s.availability}% usable</span><span>${durationText(r.hours)}</span></div>
            <div class="row"><span>Egress fee${r.unverified ? ' <span class="tag warn">unverified</span>' : ''}</span><span>${egressCell}</span></div>` : `
            <div class="row"><span>Time: lead time plus transfer, all data</span><span>${durationText(r.hours)}</span></div>
            <div class="row"><span>${r.route.label}, all data from steps 01 and 02 <span class="tag warn">estimate</span></span><span>${d(r.egressCharged)}</span></div>`;
        const fallback = s.route !== 'internet' && r.viaInternet
            ? `<div class="row muted-note"><span>No shipped device for exports from ${P.source[s.cloud].label} in the EU, so this uses the public internet.</span><span></span></div>` : '';
        document.getElementById('exitResult').innerHTML = fallback + moveRows + `
            <div class="row"><span>Read requests (${s.objectSize} objects)</span><span>${d(r.api)}</span></div>
            <div class="row total"><span>One-time exit bill</span><span>${d(r.total)}</span></div>`;
    }

    function renderRoutes(s, rt) {
        const d = (x) => fmt(toDisplay(x, rt.currency), 0);
        const order = ['internet', 'link', 'device'];
        const notes = order.map((k) => rt.routes[k].note).filter(Boolean);
        const eu = s.region === 'eu-west' ? '' : ' Private line and device prices are for EU regions.';
        document.getElementById('routes').innerHTML = `<table>
            <thead><tr><th>Route for ${rt.tb.toLocaleString('en')} TB</th><th>Ready in</th><th>Transfer</th><th>Charges</th><th>Leaving programme</th></tr></thead>
            <tbody>${order.map((k) => {
                const x = rt.routes[k];
                const cls = k === rt.chosen ? ' class="best"' : '';
                if (!x.available) return `<tr><td${cls}>${x.label}</td><td colspan="4" style="text-align:left;white-space:normal;font-family:var(--sans);color:var(--ink-2)">Not available: ${x.note}</td></tr>`;
                return `<tr><td${cls}>${x.label}${x.unverified ? '<span class="flag" title="Estimate: some parts are not published list prices">est</span>' : ''}</td>
                    <td>${x.readyWeeks ? weeksText(x.readyWeeks) : 'now'}</td>
                    <td>${durationText(x.hours)}</td>
                    <td>${x.strike != null ? `<span class="strike">${d(x.strike)}</span> ` : ''}${d(x.cost)}</td>
                    <td>${x.waiver ? (s.waiver ? 'applied' : 'covered') : 'not covered'}</td></tr>`;
            }).join('')}</tbody></table>
            <ul class="footnotes">${notes.filter((n) => !n.startsWith('AWS Snowball') && !n.startsWith('Google Transfer')).map((n) => `<li>${n}</li>`).join('')}
            <li>Charges are only for moving the data; Snowflake unload credits come on top. ${P.transfer.tools}${eu}</li></ul>`;
    }

    // ---------- 02 Data platform: one-time exit ----------
    function calcDataExit(s, exit) {
        const out = { currency: 'USD', rows: [], total: 0, hours: 0 };
        if (s.dp === 'none' || !s.dpTB) return out;
        const cfg = P.egress[s.cloud];
        const tiers = cfg.regions[s.region].tiers;
        const gb = s.dpTB * 1024;
        const D = P.dataPlatforms[s.dp];
        // Egress for data leaving from your own bucket, stacked on top of step 01's volume (same monthly tiers).
        const bucketEgress = tieredCost(tiers, s.dataTB * 1024 + gb) - tieredCost(tiers, s.dataTB * 1024);
        const other = !exit.viaInternet; // a private line or device carries this data, booked in step 01
        const bucketCharged = other || s.waiver ? 0 : bucketEgress;
        const requests = gb * 1024 / D.fileMB * val(cfg.requestPrice);
        const lineTime = exit.gbPerSec > 0 ? gb / exit.gbPerSec / 3600 : Infinity;

        if (s.dp === 'databricks') {
            out.rows.push({ label: other ? `Delta tables move with your ${exit.route.label} (counted in step 01)` : `Egress of Delta tables from your ${cfg.label} bucket${s.waiver ? ' (waived)' : ''}`, amount: bucketCharged, strike: s.waiver && !other ? bucketEgress : null });
            out.rows.push({ label: 'Read requests (~128 MB Parquet files)', amount: requests });
            out.total = bucketCharged + requests;
            out.hours = other ? 0 : lineTime;
            return out;
        }

        // Snowflake: credits to unload, then either Snowflake's transfer fee or your own bucket's egress.
        const tbh = s.sfTBh || val(D.unloadTBPerHour[s.sfWh]);
        const unloadHours = s.dpTB / tbh;
        const credits = unloadHours * D.creditsPerHour[s.sfWh];
        const compute = credits * val(D.creditPrice[s.sfEdition]);
        const direct = s.dpTB * val(D.transferPerTB[s.cloud]);
        const viaBucket = bucketCharged + requests;
        const useBucket = other || viaBucket <= direct;
        out.rows.push({ label: `Unload with COPY INTO: ${unloadHours.toFixed(1)} h on ${s.sfWh}, ${Math.round(credits)} credits`, amount: compute, unverified: !s.sfTBh && unv(D.unloadTBPerHour[s.sfWh]) });
        out.rows.push({ label: `Route A: Snowflake transfer fee to internet${useBucket ? '' : ' (cheaper)'}`, amount: direct, muted: useBucket, unverified: unv(D.transferPerTB[s.cloud]) });
        out.rows.push({ label: other ? `Route B: unload to your own ${cfg.label} bucket, then your ${exit.route.label} (counted in step 01)` : `Route B: unload to your own ${cfg.label} bucket, then egress${s.waiver ? ' (waived)' : ''}${useBucket ? ' (cheaper)' : ''}`, amount: viaBucket, muted: !useBucket });
        out.total = compute + (useBucket ? viaBucket : direct);
        out.hours = unloadHours + (other ? 0 : lineTime);
        return out;
    }

    function renderDataExit(s, r) {
        document.querySelectorAll('[data-show]').forEach((el) => {
            const k = el.dataset.show;
            el.hidden = k === 'replace' ? (s.dp === 'none' || s.dpTarget !== 'replace') : s.dp !== k;
        });
        const sf = document.querySelector('[data-key="sfTBh"]');
        sf.placeholder = `${val(P.dataPlatforms.snowflake.unloadTBPerHour[s.sfWh])} (estimate)`;
        document.getElementById('dpNote').innerHTML = s.dp === 'none' ? '' : P.dataPlatforms[s.dp].note;
        const box = document.getElementById('dpResult');
        if (s.dp === 'none') { box.hidden = true; return; }
        box.hidden = false;
        const d = (x) => fmt(toDisplay(x, r.currency), 0);
        box.innerHTML = r.rows.map((row) => `<div class="row${row.muted ? ' muted' : ''}"><span>${row.label}${row.unverified ? ' <span class="tag warn">estimate</span>' : ''}</span><span>${row.strike != null ? `<span class="strike">${d(row.strike)}</span>` : ''}${d(row.amount)}</span></div>`).join('') + `
            <div class="row"><span>${s.route === 'internet' || !r.hours ? 'Time: unload plus transfer at your bandwidth' : 'Time to unload (transfer counted in step 01)'}</span><span>${durationText(r.hours)}</span></div>
            <div class="row total"><span>One-time data platform exit</span><span>${d(r.total)}</span></div>`;
    }

    // ---------- 03 Run: monthly cost ----------
    // Each calculator returns line items: { key, label, amount, currency, unverified, note }
    const LINES = [
        ['compute', 'Compute'],
        ['db', 'Managed PostgreSQL'],
        ['object', 'Object storage'],
        ['block', 'Block storage'],
        ['egress', 'Internet egress'],
        ['xregion', 'Cross-region traffic'],
        ['nat', 'NAT'],
        ['lb', 'Load balancers'],
        ['svc', 'Self-hosted services'],
        ['dp', 'Data platform'],
    ];

    function vmCount(s) { return SIZES.reduce((n, k) => n + s[SIZE_KEYS[k]], 0); }

    function calcSource(s) {
        const a = P.source[s.cloud], cur = a.currency, L = {}, R = s.regions || 1;
        let u = false, comp = 0;
        for (const k of SIZES) { comp += s[SIZE_KEYS[k]] * val(a.compute[k].month); u = u || (s[SIZE_KEYS[k]] > 0 && unv(a.compute[k].month)); }
        L.compute = { amount: comp * R, unverified: u };

        if (s.db !== 'none') {
            const tier = a.db[s.db];
            const inst = s.dbHA ? tier.ha : tier.single;
            L.db = { amount: R * (val(inst) + s.dbGB * val(a.dbStorageGB) * (s.dbHA ? 2 : 1)), unverified: unv(inst) || unv(a.dbStorageGB) };
        } else L.db = { amount: 0 };

        L.object = { amount: R * s.objTB * 1024 * val(a.objectGB), unverified: unv(a.objectGB) };
        L.block = { amount: R * s.blockTB * 1024 * val(a.blockGB), unverified: unv(a.blockGB) };
        const eg = P.egress[s.cloud].regions[a.egressRegion];
        L.egress = { amount: tieredCost(eg.tiers, s.egressTB * 1024), unverified: unv(eg) };
        L.xregion = { amount: R > 1 ? s.xregionGB * val(a.interRegionGB) : 0, unverified: unv(a.interRegionGB) };
        L.nat = { amount: R * (s.nat * val(a.natHour) * HOURS + s.natGB * val(a.natGB)), unverified: unv(a.natHour) || unv(a.natGB) };
        L.lb = { amount: R * s.lb * val(a.lbMonth), unverified: unv(a.lbMonth), note: a.lbNote };
        return { currency: cur, lines: L };
    }

    // Data platform: today's spend on the current cloud. On an EU provider it is either kept as-is
    // (neither vendor runs on an EU-owned provider) or replaced by a cluster plus object storage.
    function addDataPlatform(r, s, p) {
        if (s.dp === 'none') return;
        const D = P.dataPlatforms[s.dp];
        if (!p || s.dpTarget === 'keep') {
            if (!s.dpSpend) return;
            const amount = r.currency === CUR ? s.dpSpend : (CUR === 'USD' ? s.dpSpend / FX : s.dpSpend * FX);
            r.lines.dp = { amount, note: p ? D.keepNote : undefined };
            return;
        }
        const o = p.objectStorage, gb = s.dpTB * 1024;
        const storage = gb > 0 ? val(o.base || 0) + Math.max(0, gb - (o.includedGB || 0)) * val(o.perGB) : 0;
        const nodes = s.dpNodes * val(p.compute.L.price);
        r.lines.dp = {
            amount: nodes + storage,
            unverified: unv(p.compute.L.price) || unv(o.perGB),
            note: `Replaced by ${s.dpNodes} × ${p.compute.L.sku} running ${D.replaceWith[p.key] || D.replaceWith.default}, plus ${s.dpTB} TB object storage.`,
        };
    }

    // Managed services that must be self-hosted add VMs per region; every service adds engineering days.
    function serviceEffort(s, key) {
        let days = 0, vms = 0;
        for (const svc of P.services.filter((x) => s.services.includes(x.key))) {
            const e = P.serviceEffort[(svc.map[key] || ['none'])[0]];
            days += e.days; vms += e.vms;
        }
        return { days, vms };
    }

    function calcEu(p, s) {
        const L = {}, R = s.regions || 1;
        let u = false, comp = 0;
        for (const k of SIZES) {
            const n = s[SIZE_KEYS[k]];
            comp += n * val(p.compute[k].price);
            u = u || (n > 0 && unv(p.compute[k].price));
        }
        L.compute = { amount: comp * R, unverified: u, note: comp > 0 ? p.computeNote : undefined };

        if (s.db === 'none') L.db = { amount: 0 };
        else if (p.db) {
            const tier = p.db[s.db];
            const inst = s.dbHA ? tier.ha : tier.single;
            const storage = s.dbGB * val(p.db.storageGB || 0) * (s.dbHA && p.db.storagePerNode ? 2 : 1);
            L.db = { amount: R * (val(inst) + storage), unverified: unv(inst) || unv(p.db.storageGB), note: p.db.note };
        } else {
            // No managed PostgreSQL: price self-hosted VMs plus block storage.
            const nodes = s.dbHA ? 2 : 1;
            const vm = p.compute[s.db].price;
            L.db = {
                amount: R * nodes * (val(vm) + s.dbGB * val(p.blockGB)),
                unverified: unv(vm) || unv(p.blockGB),
                note: `No managed PostgreSQL: priced as ${nodes} self-hosted ${p.compute[s.db].sku} VM${nodes > 1 ? 's' : ''} with volumes.`
            };
        }

        const o = p.objectStorage;
        const objGB = s.objTB * 1024;
        L.object = objGB > 0
            ? { amount: R * (val(o.base || 0) + Math.max(0, objGB - (o.includedGB || 0)) * val(o.perGB)), unverified: unv(o.perGB) || unv(o.base), note: o.note }
            : { amount: 0 };

        L.block = { amount: R * s.blockTB * 1024 * val(p.blockGB), unverified: unv(p.blockGB) };

        const e = p.egress;
        const freeGB = (e.includedGB || 0) + (e.includedGBPerVM || 0) * vmCount(s) * R;
        L.egress = { amount: Math.max(0, s.egressTB * 1024 - freeGB) * val(e.perGB), unverified: unv(e.perGB), note: e.note };

        const x = p.interRegion;
        L.xregion = R > 1 && s.xregionGB > 0
            ? (x ? { amount: s.xregionGB * val(x.perGB), unverified: unv(x.perGB), note: x.note } : { amount: 0 })
            : { amount: 0 };

        if (s.nat === 0) L.nat = { amount: 0 };
        else if (p.nat) L.nat = { amount: R * (s.nat * val(p.nat.price) + s.natGB * val(p.nat.perGB || 0)), unverified: unv(p.nat.price), note: p.nat.note };
        else L.nat = { amount: R * s.nat * val(p.compute.S.price), unverified: unv(p.compute.S.price), note: `No NAT product: priced as a ${p.compute.S.sku} VM per gateway.` };

        L.lb = { amount: R * s.lb * val(p.lb.price), unverified: unv(p.lb.price) };
        const eff = serviceEffort(s, p.key);
        L.svc = eff.vms
            ? { amount: R * eff.vms * val(p.compute.S.price), unverified: unv(p.compute.S.price), note: `${eff.vms} × ${p.compute.S.sku} per region to run services you host yourself.` }
            : { amount: 0 };
        return { currency: p.currency, lines: L };
    }

    function sumLines(r) {
        return Object.values(r.lines).reduce((t, l) => t + toDisplay(l.amount, r.currency), 0);
    }

    // best = best net result after three years (picked in update), cheapest = lowest monthly bill.
    function renderCompare(s, src, eus, totals, best, cheapest) {
        const S = P.source[s.cloud];
        const cols = [{ key: 'src', label: `${S.label}<br><small>${S.regionLabel}</small>`, r: src }]
            .concat(Object.entries(eus).map(([k, r]) => {
                const p = P.providers[k];
                const href = p.referral || p.url;
                return { key: k, label: `<a href="${href}" target="_blank" rel="noopener sponsored">${p.label}</a><br><small>${p.regionLabel}</small>`, r };
            }));
        const tag = (k) => k === best && k === cheapest ? '<span class="pick">cheapest and best over 3 years</span>'
            : k === best ? '<span class="pick">best over 3 years</span>'
            : k === cheapest ? '<span class="pick alt">cheapest to run</span>' : '';

        // Identical notes share one footnote number, listing every provider it applies to.
        const notes = new Map();
        const cell = (c, key) => {
            const l = c.r.lines[key];
            if (!l || l.amount === 0) return '—';
            let flag = '';
            if (l.note) {
                if (!notes.has(l.note)) notes.set(l.note, { n: notes.size + 1, who: [] });
                const fn = notes.get(l.note);
                fn.who.push(c.key === 'src' ? S.label : P.providers[c.key].label);
                flag += `<span class="flag" title="${l.note}">${fn.n}</span>`;
            }
            if (l.unverified) flag += '<span class="flag" title="Unverified price">?</span>';
            return fmt(toDisplay(l.amount, c.r.currency)) + flag;
        };
        const cls = (c) => (c.key === best ? ' class="best"' : '');

        const rows = LINES
            .filter(([key]) => cols.some((c) => c.r.lines[key] && c.r.lines[key].amount > 0))
            .map(([key, label]) => `<tr><td>${label}</td>${cols.map((c) => `<td${cls(c)}>${cell(c, key)}</td>`).join('')}</tr>`)
            .join('');

        const saving = cols.map((c) => {
            if (c.key === 'src') return '<td></td>';
            const d = totals.src - totals[c.key];
            const pct = totals.src > 0 ? Math.round((d / totals.src) * 100) : 0;
            return `<td${cls(c)} class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '−' : '+'}${fmt(Math.abs(d))} (${pct}%)</td>`;
        }).join('');

        document.getElementById('compare').innerHTML = `
            <table>
                <thead><tr><th>Per month, ex VAT</th>${cols.map((c) => `<th${cls(c)}>${c.label}${tag(c.key)}</th>`).join('')}</tr></thead>
                <tbody>${rows}
                    <tr class="total"><td>Total per month</td>${cols.map((c) => `<td${cls(c)}>${fmt(totals[c.key])}</td>`).join('')}</tr>
                    <tr class="saving"><td>Saving vs ${S.label}</td>${saving}</tr>
                </tbody>
            </table>
            <ol class="footnotes">${[...notes].map(([text, fn]) => `<li>${fn.n}. <strong>${fn.who.join(', ')}:</strong> ${text}</li>`).join('')}
                ${cols.some((c) => Object.values(c.r.lines).some((l) => l.unverified)) ? '<li>? Price could not be confirmed on the official page. Check before relying on it.</li>' : ''}
            </ol>`;
    }

    function renderGaps(s) {
        const box = document.getElementById('gaps');
        const picked = P.services.filter((x) => s.services.includes(x.key));
        if (!picked.length) { box.innerHTML = ''; return; }
        const keys = Object.keys(P.providers);
        const icon = { native: '●', partial: '◐', none: '○' };
        box.innerHTML = `
            <h3>What has no direct replacement</h3>
            <table>
                <thead><tr><th>You use</th>${keys.map((k) => `<th>${P.providers[k].label}</th>`).join('')}</tr></thead>
                <tbody>${picked.map((svc) => `<tr><td><strong>${svc.label}</strong></td>${keys.map((k) => {
                    const [status, text] = svc.map[k] || svc.map.default;
                    return `<td class="s-${status}">${icon[status]} ${text}</td>`;
                }).join('')}</tr>`).join('')}
                <tr class="total"><td>Extra effort</td>${keys.map((k) => {
                    const e = serviceEffort(s, k);
                    return `<td>+${e.days} days${e.vms ? `, +${e.vms} VMs` : ''}</td>`;
                }).join('')}</tr></tbody>
            </table>
            <p class="footnotes">● managed equivalent · ◐ partial or compatible API, test it · ○ you run it yourself. Your current spend on these services is not counted on either side.</p>`;
    }

    // ---------- 03 Payback ----------
    function calcPayback(s, exitTotal, totals) {
        return Object.keys(P.providers).map((k) => {
            const monthly = totals.src - totals[k];
            const days = s.engDays + serviceEffort(s, k).days;
            const oneTime = exitTotal + s.parallel * totals[k] + days * s.dayRate;
            const months = monthly > 0 ? Math.ceil(oneTime / monthly) : Infinity;
            return { key: k, monthly, oneTime, days, months, threeYear: monthly * 36 - oneTime };
        });
    }

    function monthsText(m) { return isFinite(m) ? `${m} month${m === 1 ? '' : 's'}` : 'never'; }

    // Elapsed time: build and the bulk data copy run side by side, then both setups run in parallel until the old one is switched off.
    function calcTimeline(s, b, dataHours) {
        const buildWeeks = b.days / Math.max(1, s.team) / 5;
        const dataWeeks = isFinite(dataHours) ? dataHours / 24 / 7 : Infinity;
        const parallelWeeks = s.parallel * 52 / 12;
        const total = Math.max(buildWeeks, dataWeeks) + parallelWeeks;
        return { buildWeeks, dataWeeks, parallelWeeks, total };
    }

    function weeksText(w) {
        if (!isFinite(w)) return '—';
        if (w < 1) return `${Math.max(1, Math.round(w * 7))} days`;
        if (w < 9) return `${Math.round(w)} week${Math.round(w) === 1 ? '' : 's'}`;
        return `${Math.round(w * 12 / 52)} months`;
    }

    function renderTimeline(s, t, b) {
        const span = isFinite(t.total) && t.total > 0 ? t.total : 1;
        const pct = (w) => `${Math.min(100, w / span * 100).toFixed(1)}%`;
        const start = Math.max(t.buildWeeks, isFinite(t.dataWeeks) ? t.dataWeeks : 0);
        const bar = (label, from, w, cls) => `<div class="tl-row"><span>${label}</span>
            <div class="tl-track"><div class="tl-bar ${cls}" style="margin-left:${pct(from)};width:${pct(w)}"></div></div>
            <span>${weeksText(w)}</span></div>`;
        return `<div class="timeline">
            <h3>How long it takes</h3>
            ${bar(`Build and migrate: ${b.days} days of work, ${s.team} engineer${s.team === 1 ? '' : 's'}`, 0, t.buildWeeks, 'build')}
            ${bar('Bulk data copy (runs alongside the build)', 0, t.dataWeeks, 'data')}
            ${bar('Both setups running, then switch off', start, t.parallelWeeks, 'run')}
            <div class="tl-row total"><span>From start to switching off ${P.source[s.cloud].label}</span><span></span><span>${weeksText(t.total)}</span></div>
            ${t.dataWeeks > t.buildWeeks ? '<p class="footnotes">The data copy is the slowest part. A faster line or an offline transfer device would shorten it; see the options under step 01.</p>' : ''}
        </div>`;
    }

    // Cumulative net per provider, month 0-36: starts at minus the one-time cost, crosses zero at break-even.
    // Colours follow the provider (fixed order), never its rank.
    const SERIES = { hetzner: '#2a78d6', scaleway: '#eb6834', ovh: '#1baf7a', exoscale: '#eda100' };
    const CH = { w: 720, h: 260, l: 64, r: 120, t: 16, b: 30, months: 36 };
    let chartData = null;
    function renderChart(pb, best) {
        // Drawn at the container's real width so text stays at its CSS size on phones.
        const cw = document.getElementById('paybackResult').clientWidth;
        CH.w = Math.max(300, cw || 720);
        CH.l = CH.w < 520 ? 46 : 64;
        CH.r = CH.w < 520 ? 114 : 120;
        const series = pb.map((x) => ({ key: x.key, label: P.providers[x.key].label, ys: Array.from({ length: CH.months + 1 }, (_, m) => x.monthly * m - x.oneTime) }));
        const all = series.flatMap((x) => x.ys).concat(0);
        let lo = Math.min(...all), hi = Math.max(...all);
        const pad = (hi - lo) * 0.06 || 1;
        lo -= pad; hi += pad;
        const X = (m) => CH.l + (m / CH.months) * (CH.w - CH.l - CH.r);
        const Y = (v) => CH.t + (hi - v) / (hi - lo) * (CH.h - CH.t - CH.b);
        chartData = { series, X, Y };
        const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)));
        const tick = [1, 2, 2.5, 5, 10].map((k) => k * step).find((t) => (hi - lo) / t <= 5);
        const ticks = [];
        for (let v = Math.ceil(lo / tick) * tick; v <= hi; v += tick) ticks.push(v);
        // End labels, nudged apart so they never overlap.
        const ends = series.map((x) => ({ x, y: Y(x.ys[CH.months]) })).sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
        const path = (ys) => ys.map((v, m) => `${m ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join('');
        return `<div class="chart">
            <h3>Three years at a glance <span class="unit">cumulative result after one-time costs</span></h3>
            <ul class="legend">${series.map((x) => `<li><i style="background:${SERIES[x.key]}"></i>${x.label}</li>`).join('')}</ul>
            <div class="chart-plot">
            <svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="Cumulative net result per provider over 36 months; the table below lists the same numbers">
                ${ticks.map((v) => `<line class="grid" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${CH.l - 8}" y="${Y(v) + 4}" text-anchor="end">${fmtShort(v)}</text>`).join('')}
                <line class="zero" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${Y(0)}" y2="${Y(0)}"/>
                <text class="ax" x="${CH.l + 4}" y="${Y(0) - 6}">break-even</text>
                ${(CH.w < 520 ? [0, 12, 24, 36] : [0, 6, 12, 18, 24, 30, 36]).map((m) => `<text class="ax" x="${X(m)}" y="${CH.h - 8}" text-anchor="middle">${m === 0 ? 'start' : 'M' + m}</text>`).join('')}
                ${series.map((x) => `<path class="line${x.key === best ? ' best' : ''}" d="${path(x.ys)}" stroke="${SERIES[x.key]}"/>`).join('')}
                ${ends.map((e) => `<text class="end" x="${X(CH.months) + 8}" y="${e.y + 4}">${e.x.label} <tspan>${fmtShort(e.x.ys[CH.months])}</tspan></text>`).join('')}
                <line class="cross" x1="0" x2="0" y1="${CH.t}" y2="${CH.h - CH.b}" visibility="hidden"/>
                ${series.map((x) => `<circle class="dot" r="4" fill="${SERIES[x.key]}" data-k="${x.key}" visibility="hidden"/>`).join('')}
                <rect class="hit" x="${CH.l}" y="0" width="${CH.w - CH.l - CH.r}" height="${CH.h}"/>
            </svg>
            <div class="tip" hidden></div></div>
        </div>`;
    }

    function wireChart() {
        const box = document.querySelector('.chart-plot');
        if (!box) return;
        const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), cross = svg.querySelector('.cross');
        const dots = [...svg.querySelectorAll('.dot')];
        const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
        const show = (ev) => {
            const { series, X, Y } = chartData;
            const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
            const p = pt.matrixTransform(svg.getScreenCTM().inverse());
            const m = Math.max(0, Math.min(CH.months, Math.round((p.x - CH.l) / (CH.w - CH.l - CH.r) * CH.months)));
            cross.setAttribute('x1', X(m)); cross.setAttribute('x2', X(m)); cross.setAttribute('visibility', 'visible');
            dots.forEach((d) => { const x = series.find((z) => z.key === d.dataset.k); d.setAttribute('cx', X(m)); d.setAttribute('cy', Y(x.ys[m])); d.setAttribute('visibility', 'visible'); });
            tip.innerHTML = `<strong>${m === 0 ? 'Start' : 'Month ' + m}</strong>${[...series].sort((a, b) => b.ys[m] - a.ys[m]).map((x) => `<div><i style="background:${SERIES[x.key]}"></i>${x.label}<span>${fmt(x.ys[m])}</span></div>`).join('')}`;
            tip.hidden = false;
            const r = box.getBoundingClientRect(), left = X(m) / CH.w * r.width;
            tip.style.left = `${left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12}px`;
        };
        svg.addEventListener('pointermove', show);
        svg.addEventListener('pointerleave', hide);
    }

    function renderPayback(s, pb, best, cheapest, dataHours, exitRaw) {
        const b = pb.find((x) => x.key === best);
        const name = P.providers[best].label;
        const why = best !== cheapest && isFinite(b.months)
            ? ` ${P.providers[cheapest].label} has the lowest monthly bill, but ${name} needs less one-time work, so ${b.threeYear >= 0 ? 'it comes out ahead' : 'it loses the least'} over three years.` : '';
        const own = exitRaw.chosen === 'link'
            ? `<p class="note">You chose a private line to your own data centre in step 01. This comparison prices EU clouds as the destination; running your own hardware is not modelled.</p>` : '';
        const hero = isFinite(b.months)
            ? `<div class="payback-hero"><div class="big">${monthsText(b.months)}</div>
               <p>Moving to <strong>${name}</strong> costs ${fmt(b.oneTime)} up front and saves ${fmt(b.monthly)} a month. It pays for itself in month ${b.months}${b.months > 36 ? ', which is longer than most hardware or contract cycles' : ''}.${why}</p></div>`
            : `<div class="payback-hero never"><div class="big">Never</div>
               <p>At these numbers no EU option is cheaper to run, not even ${P.providers[cheapest].label}, so the move does not pay for itself against to run than ${P.source[s.cloud].label}. Check whether reserved instances, savings plans or committed-use discounts are already in your current price, or if sovereignty rather than cost is the reason to move.</p></div>`;
        const t = calcTimeline(s, b, dataHours);
        b.timeline = t;
        const rows = [...pb].sort((x, y) => y.threeYear - x.threeYear);
        document.getElementById('paybackResult').innerHTML = hero + own + renderTimeline(s, t, b) + renderChart(pb, best) + `
            <div class="compare"><table>
                <thead><tr><th>Provider</th><th>Engineering days</th><th>One-time cost</th><th>Monthly saving</th><th>Break-even</th><th>Net after 3 years</th></tr></thead>
                <tbody>${rows.map((x) => `<tr><td${x.key === best ? ' class="best"' : ''}>${P.providers[x.key].label}</td>
                    <td>${x.days}</td>
                    <td>${fmt(x.oneTime)}</td>
                    <td class="${x.monthly >= 0 ? 'pos' : 'neg'}">${fmt(x.monthly)}</td>
                    <td>${monthsText(x.months)}</td>
                    <td class="${x.threeYear >= 0 ? 'pos' : 'neg'}">${fmt(x.threeYear)}</td></tr>`).join('')}</tbody>
            </table>
            <p class="footnotes">One-time cost = exit bill + data platform exit + months running both setups × EU monthly cost + (your engineering days + days for the selected services) × day rate. Your current cloud keeps billing during the parallel run, so we count only the extra EU bill.</p></div>`;
        wireChart();
        return b;
    }

    function renderHeadline(s, exit, totals, best, b) {
        const name = P.providers[best].label, src = P.source[s.cloud].label;
        document.getElementById('headline').innerHTML = `
            <div data-step="exit"><div class="lbl">Exit bill</div><div class="val">${fmt(exit.total)}</div><div class="sub">one-time, ${durationText(exit.hours)} to move the data</div></div>
            <div data-step="run"><div class="lbl">${src} → ${name}</div><div class="val">${fmt(totals.src)} → ${fmt(totals[best])}</div><div class="sub">per month, same setup</div></div>
            <div data-step="payback"><div class="lbl">Break-even</div><div class="val">${isFinite(b.months) ? 'Month ' + b.months : 'Never'}</div><div class="sub">${isFinite(b.months) ? fmt(b.threeYear) + ' net after 3 years' : 'not cheaper at list prices'} · about ${weeksText(b.timeline.total)} to complete the move</div></div>`;
    }

    // ---------- Share / email ----------
    let lastSummary = '';
    function updateLinks(s, exit, totals, best, b) {
        const url = `${location.origin}${location.pathname}?${stateToQuery(s)}`;
        history.replaceState(null, '', `?${stateToQuery(s)}`);
        const name = P.providers[best].label;
        lastSummary = [
            `ExitCost report`,
            `Exit bill (${s.cloud.toUpperCase()}, ${s.dataTB} TB${s.dp !== 'none' ? ` + ${s.dpTB} TB ${s.dp}` : ''}): ${fmt(exit.total)}`,
            `Monthly: ${P.source[s.cloud].label} ${fmt(totals.src)} vs ${name} ${fmt(totals[best])}`,
            `Break-even: ${isFinite(b.months) ? 'month ' + b.months : 'never'}`,
            `Time to complete the move: about ${weeksText(b.timeline.total)}`,
            ``, `Full report: ${url}`
        ].join('\n');
        document.getElementById('emailLink').href =
            `mailto:?subject=${encodeURIComponent('My cloud exit cost report')}&body=${encodeURIComponent(lastSummary)}`;
        document.getElementById('copyLink').onclick = async (ev) => {
            try { await navigator.clipboard.writeText(url); ev.target.textContent = 'Copied'; }
            catch { prompt('Copy this link', url); }
            setTimeout(() => { ev.target.textContent = 'Copy share link'; }, 1500);
        };
    }

    // ---------- Main ----------
    let autoSvc = null; // service chip ticked automatically by the data platform choice
    function update() {
        const s = readState();
        CUR = s.currency;
        FX = s.fx || P.fxEurUsd;
        document.querySelectorAll('[data-cur-unit]').forEach((el) => { el.textContent = CUR; });

        // Replacing a data platform brings its rebuild into the service mapping; undo that when the choice changes.
        const want = s.dp !== 'none' && s.dpTarget === 'replace' ? P.dataPlatforms[s.dp].serviceKey : null;
        if (autoSvc && autoSvc !== want) {
            s.services = s.services.filter((k) => k !== autoSvc);
            document.querySelector(`[data-svc="${autoSvc}"]`).checked = false;
            autoSvc = null;
        }
        if (want && !s.services.includes(want)) {
            s.services.push(want);
            document.querySelector(`[data-svc="${want}"]`).checked = true;
            autoSvc = want;
        }

        const rt = calcRoutes(s);
        const exitRaw = calcExit(s, rt);
        renderExit(s, exitRaw);
        renderRoutes(s, rt);
        const dpExit = calcDataExit(s, exitRaw);
        renderDataExit(s, dpExit);
        const exit = {
            total: toDisplay(exitRaw.total, exitRaw.currency) + toDisplay(dpExit.total, dpExit.currency),
            hours: exitRaw.hours + dpExit.hours,
        };

        const src = calcSource(s);
        addDataPlatform(src, s, null);
        const eus = Object.fromEntries(Object.entries(P.providers).map(([k, p]) => {
            const r = calcEu(p, s);
            addDataPlatform(r, s, p);
            return [k, r];
        }));
        const totals = { src: sumLines(src) };
        for (const [k, r] of Object.entries(eus)) totals[k] = sumLines(r);
        // Day rate is entered in the display currency, so payback stays in display currency.
        const pb = calcPayback(s, exit.total, totals);
        const keys = Object.keys(eus);
        const cheapest = keys.reduce((a, k) => (totals[k] < totals[a] ? k : a));
        const best = pb.reduce((a, x) => (x.threeYear > a.threeYear ? x : a)).key;
        renderCompare(s, src, eus, totals, best, cheapest);
        document.querySelectorAll('[data-src-label]').forEach((el) => { el.textContent = P.source[s.cloud].label; });
        document.getElementById('srcRegionLabel').textContent = P.source[s.cloud].regionLabel;
        renderGaps(s);

        const b = renderPayback(s, pb, best, cheapest, exit.hours, exitRaw);
        renderHeadline(s, exit, totals, best, b);
        renderSums(s, exitRaw, dpExit, totals, best, b);
        updateLinks(s, exit, totals, best, b);
    }

    // Live result in each step header and in the top bar.
    function renderSums(s, exitRaw, dpExit, totals, best, b) {
        const exitAmt = toDisplay(exitRaw.total, exitRaw.currency);
        const dpAmt = toDisplay(dpExit.total, dpExit.currency);
        const sums = {
            exit: [fmt(exitAmt), durationText(exitRaw.hours), fmtShort(exitAmt)],
            data: s.dp === 'none' ? ['None', 'no data platform', '—'] : [fmt(dpAmt), s.dp === 'snowflake' ? 'Snowflake exit' : 'Databricks exit', fmtShort(dpAmt)],
            run: [`${fmt(totals[best])}<small>/mo</small>`, `on ${P.providers[best].label}, now ${fmt(totals.src)}`, `${fmtShort(totals[best])}/mo`],
            payback: isFinite(b.months)
                ? [`Month ${b.months}`, `done in about ${weeksText(b.timeline.total)}`, `M${b.months}`]
                : ['Never', 'not cheaper at list prices', 'never'],
        };
        for (const [k, [val, sub, short]] of Object.entries(sums)) {
            document.querySelector(`[data-sum="${k}"]`).innerHTML = `<strong>${val}</strong><span>${sub}</span>`;
            document.querySelector(`[data-nav="${k}"]`).textContent = short;
        }
    }

    // Highlight the step in view.
    const navLinks = [...document.querySelectorAll('.stepper a')];
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            navLinks.forEach((a) => a.classList.toggle('active', a.dataset.step === e.target.id));
        }
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.sheet[data-step]').forEach((el) => io.observe(el));

    for (const [k, p] of Object.entries(P.providers)) p.key = k;
    const E = P.serviceEffort;
    document.getElementById('svcRule').textContent =
        `${E.none.vms} small VMs and ${E.none.days} engineering days per service you host yourself (${E.partial.days} days if partly compatible, ${E.native.days} if there is a managed equivalent)`;
    renderServiceChips();
    document.querySelector('[data-key="fx"]').value = P.fxEurUsd;
    document.getElementById('lastVerified').textContent = P.lastVerified;
    loadFromQuery();
    document.addEventListener('input', update);
    document.addEventListener('change', update);
    let lastW = innerWidth, rz;
    addEventListener('resize', () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rz); rz = setTimeout(update, 150); });
    update();
})();
