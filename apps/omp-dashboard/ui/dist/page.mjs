import { jsxs as r, jsx as e, Fragment as B } from "react/jsx-runtime";
import { useState as k, useId as qe, useRef as O, useEffect as I, useMemo as He, useCallback as ue } from "react";
import { Badge as q, ContentSkeleton as U, SegmentedControl as Ae, StatCard as E, Card as w, EmptyState as me, CardTitle as T, Btn as je, PageHeader as Ke } from "@kirocrew/app-sdk/ui";
import { Activity as H, Bot as _, ArrowUpLeft as Ge, X as Ye, Wrench as Ve, User as Qe, Terminal as Xe, Loader2 as he, RefreshCw as Je } from "lucide-react";
import { activeLocale as K, fmtNumber as f, fmtTime as ae, fmtDate as j, fmtDateTime as G, fmtRelative as Ze, useAppApi as Y, useAppInfo as et } from "@kirocrew/app-sdk";
import { useQuery as se, keepPreviousData as tt } from "@tanstack/react-query";
const Te = ["1h", "3h", "6h", "12h", "24h", "7d", "30d", "all"], ge = "24h", D = 36e5, N = 24 * D, Re = {
  "1h": D,
  "3h": 3 * D,
  "6h": 6 * D,
  "12h": 12 * D,
  "24h": N,
  "7d": 7 * N,
  "30d": 30 * N,
  all: null
};
function at(t, o) {
  switch (t) {
    case "1h":
    case "3h":
      return 10 * 6e4;
    case "6h":
      return 15 * 6e4;
    case "12h":
      return 30 * 6e4;
    case "24h":
      return D;
    case "7d":
    case "30d":
      return N;
    case "all":
      return o > 60 * N ? 7 * N : N;
  }
}
function nt(t, o, n) {
  const a = Re[o];
  if (a == null) return [...t];
  const i = n - a;
  return t.filter((s) => s.start >= i);
}
function $e(t) {
  return t.filter((o) => o.kind === "subagent");
}
function ot(t) {
  if (t.length === 0) return null;
  const o = [...t].sort((a, i) => a - i), n = o.length >> 1;
  return o.length % 2 ? o[n] : (o[n - 1] + o[n]) / 2;
}
function ze(t) {
  return t.filter((o) => o.outcome === "running").sort((o, n) => n.last_activity - o.last_activity);
}
function rt(t, o) {
  let n = 0, a = 0, i = 0;
  const s = /* @__PURE__ */ new Set();
  for (const d of t)
    s.add(d.agent), i += d.cost, d.outcome !== "running" && (a += 1, d.outcome === "ok" && (n += 1));
  return {
    spawned: t.length,
    finished: a,
    ok: n,
    okRate: a > 0 ? n / a : null,
    cost: i,
    agentTypes: s.size,
    running: o
  };
}
function De(t) {
  const o = /* @__PURE__ */ new Map();
  for (const a of t) {
    let i = o.get(a.agent);
    i || (i = {
      s: {
        agent: a.agent,
        spawned: 0,
        ok: 0,
        error: 0,
        aborted: 0,
        running: 0,
        okRate: null,
        cost: 0,
        tokens: 0,
        tools: 0,
        medianDurationMs: null,
        models: [],
        lastUsed: 0
      },
      durations: [],
      models: /* @__PURE__ */ new Map()
    }, o.set(a.agent, i));
    const s = i.s;
    switch (s.spawned += 1, s.cost += a.cost, s.tokens += a.tokens, s.tools += a.tools, a.start > s.lastUsed && (s.lastUsed = a.start), a.outcome) {
      case "ok":
        s.ok += 1;
        break;
      case "error":
        s.error += 1;
        break;
      case "aborted":
        s.aborted += 1;
        break;
      case "running":
        s.running += 1;
        break;
    }
    a.duration_ms > 0 && i.durations.push(a.duration_ms), a.model && i.models.set(a.model, (i.models.get(a.model) ?? 0) + 1);
  }
  const n = [];
  for (const { s: a, durations: i, models: s } of o.values()) {
    const d = a.spawned - a.running;
    a.okRate = d > 0 ? a.ok / d : null, a.medianDurationMs = ot(i), a.models = [...s.entries()].map(([l, p]) => ({ model: l, count: p })).sort((l, p) => p.count - l.count), n.push(a);
  }
  return n.sort((a, i) => i.spawned - a.spawned || a.agent.localeCompare(i.agent));
}
function it(t, o, n) {
  const a = De(t).map((h) => h.agent), i = new Map(a.map((h, m) => [h, m])), s = Re[o];
  let d;
  if (s != null) d = n - s;
  else {
    d = n;
    for (const h of t) h.start < d && (d = h.start);
  }
  const l = at(o, n - d), p = (h) => {
    if (l < N) return Math.floor(h / l) * l;
    const m = new Date(h);
    return m.setHours(0, 0, 0, 0), l > N && m.setDate(m.getDate() - (m.getDay() + 6) % 7), m.getTime();
  }, u = p(d), c = [], x = /* @__PURE__ */ new Map();
  for (let h = u; h <= n; h = l < N ? h + l : st(h, l)) {
    const m = { t: h, counts: new Array(a.length).fill(0), total: 0 };
    c.push(m), x.set(h, m);
  }
  let v = 0;
  for (const h of t) {
    const m = x.get(p(h.start));
    if (!m) continue;
    const g = i.get(h.agent);
    g !== void 0 && (m.counts[g] += 1, m.total += 1, m.total > v && (v = m.total));
  }
  return { agents: a, buckets: c, bucketMs: l, max: v };
}
function st(t, o) {
  const n = new Date(t);
  return n.setDate(n.getDate() + Math.round(o / N)), n.setHours(0, 0, 0, 0), n.getTime();
}
const lt = [
  "var(--ctx-src-skill)",
  "var(--ctx-src-memory)",
  "var(--ctx-src-history)",
  "var(--ctx-src-lessons)",
  "var(--ctx-src-sys)",
  "var(--ctx-src-skillidx)",
  "var(--ctx-src-tool)"
], dt = "var(--ctx-src-mute, var(--muted))";
function P(t) {
  return lt[t] ?? dt;
}
function ct(t, o) {
  const n = new Date(o);
  n.setHours(0, 0, 0, 0);
  const a = $e(t).filter((i) => i.start >= n.getTime());
  return {
    running: ze(t).length,
    runs: a.length,
    cost: a.reduce((i, s) => i + s.cost, 0)
  };
}
const pt = {
  "1h": "1h",
  "3h": "3h",
  "6h": "6h",
  "12h": "12h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "All"
}, fe = {
  running: "Running",
  ok: "OK",
  error: "Error",
  aborted: "Aborted",
  unfinished: "Unfinished",
  "no data": "No data"
}, Ie = {
  running: "aim",
  ok: "ok",
  error: "err",
  aborted: "err",
  unfinished: "warn",
  "no data": "muted"
};
function Ce(t) {
  return fe[t] ?? fe["no data"];
}
function S(t) {
  const o = t === 0 ? 2 : t < 0.1 ? 4 : 2;
  return new Intl.NumberFormat(K(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: t === 0 || t >= 0.1 ? void 0 : o,
    maximumFractionDigits: o
  }).format(t);
}
function C(t) {
  return new Intl.NumberFormat(K(), { style: "percent", maximumFractionDigits: 0 }).format(t);
}
function M(t) {
  return new Intl.NumberFormat(K(), { notation: "compact", maximumFractionDigits: 1 }).format(t);
}
function V(t) {
  if (t == null || t <= 0) return "—";
  const o = Math.round(t / 1e3), n = Math.floor(o / 3600), a = Math.floor(o % 3600 / 60), i = o % 60;
  return n > 0 ? `${n}h ${a}m` : a > 0 ? `${a}m ${i}s` : `${i}s`;
}
function Ee(t) {
  return new Intl.NumberFormat(K(), { style: "currency", currency: "USD", maximumFractionDigits: t >= 100 ? 0 : 2 }).format(t);
}
function ut(t) {
  return t == null ? "—" : t >= 1e3 ? `${(t / 1e3).toFixed(1)}s` : `${Math.round(t)}ms`;
}
const Oe = 864e5, ne = 44, J = 14, Z = 2 * Math.PI * ne, R = 140;
function mt({ stats: t, total: o }) {
  const [n, a] = k(null);
  let i = 0;
  const s = t.map((d, l) => {
    const p = o > 0 ? d.spawned / o : 0, u = { i: l, s: d, frac: p, offset: i };
    return i += p, u;
  });
  return /* @__PURE__ */ r("div", { className: "oa-donut", "data-testid": "agents-donut", children: [
    /* @__PURE__ */ r("div", { className: "oa-donut-ring", children: [
      /* @__PURE__ */ r("svg", { viewBox: "0 0 120 120", "aria-hidden": "true", children: [
        /* @__PURE__ */ e("circle", { cx: "60", cy: "60", r: ne, fill: "none", strokeWidth: J, style: { stroke: "var(--bg-hover)" } }),
        s.map(({ i: d, frac: l, offset: p }) => l > 0 && /* @__PURE__ */ e(
          "circle",
          {
            cx: "60",
            cy: "60",
            r: ne,
            fill: "none",
            strokeWidth: n === d ? J + 4 : J,
            strokeDasharray: `${l * Z} ${Z}`,
            strokeDashoffset: -p * Z,
            style: { stroke: P(d), transition: "stroke-width .15s" },
            onMouseEnter: () => a(d),
            onMouseLeave: () => a(null)
          },
          d
        ))
      ] }),
      /* @__PURE__ */ r("div", { className: "oa-donut-center", children: [
        /* @__PURE__ */ e("span", { className: "oa-donut-total", children: f(n == null ? o : s[n].s.spawned) }),
        /* @__PURE__ */ e("span", { className: "oa-donut-label", children: n == null ? "Spawned" : s[n].s.agent })
      ] })
    ] }),
    /* @__PURE__ */ e("ul", { className: "oa-legend", "aria-label": "Spawned by agent type", children: s.map(({ i: d, s: l, frac: p }) => /* @__PURE__ */ r(
      "li",
      {
        "data-hover": n === d,
        onMouseEnter: () => a(d),
        onMouseLeave: () => a(null),
        children: [
          /* @__PURE__ */ e("span", { className: "oa-swatch", style: { background: P(d) } }),
          /* @__PURE__ */ e("span", { className: "oa-legend-name oa-mono", children: l.agent }),
          /* @__PURE__ */ r("span", { className: "oa-legend-n", children: [
            f(l.spawned),
            " · ",
            C(p)
          ] })
        ]
      },
      l.agent
    )) })
  ] });
}
function xe(t, o) {
  return o < Oe ? G(t) : j(t);
}
function ht({ timeline: t }) {
  const { buckets: o, agents: n, max: a, bucketMs: i } = t, [s, d] = k(null), l = qe(), p = o.length, u = p > 0 ? 100 / p : 100, c = a > 0 ? (R - 4) / a : 0, x = u * 0.12, v = Math.max(1, Math.ceil(p / 6)), h = s != null ? o[s] : null;
  return /* @__PURE__ */ r("div", { style: { minWidth: 0 }, "data-testid": "agents-timeline", children: [
    /* @__PURE__ */ r("div", { className: "oa-tl", children: [
      /* @__PURE__ */ r("div", { className: "oa-tl-axis", style: { height: R }, children: [
        /* @__PURE__ */ e("span", { style: { top: 0 }, children: f(a) }),
        /* @__PURE__ */ e("span", { style: { bottom: 0 }, children: f(0) })
      ] }),
      /* @__PURE__ */ r("div", { className: "oa-tl-plot", style: { height: R }, onMouseLeave: () => d(null), children: [
        /* @__PURE__ */ r("svg", { viewBox: `0 0 100 ${R}`, preserveAspectRatio: "none", "aria-labelledby": `${l}-title`, children: [
          /* @__PURE__ */ e("title", { id: `${l}-title`, children: "Spawns over time" }),
          /* @__PURE__ */ e("line", { x1: "0", x2: "100", y1: R - 0.5, y2: R - 0.5, style: { stroke: "var(--border)" }, strokeWidth: "1", vectorEffect: "non-scaling-stroke" }),
          o.map((m, g) => {
            let b = R;
            return /* @__PURE__ */ r(
              "g",
              {
                onMouseEnter: () => d(g),
                style: { opacity: s != null && s !== g ? 0.6 : 1, transition: "opacity .12s" },
                children: [
                  /* @__PURE__ */ r("title", { children: [
                    xe(m.t, i),
                    ": ",
                    f(m.total)
                  ] }),
                  /* @__PURE__ */ e("rect", { x: g * u, y: "0", width: u, height: R, fill: "transparent" }),
                  m.counts.map((y, $) => {
                    if (y === 0) return null;
                    const F = y * c;
                    return b -= F, /* @__PURE__ */ e("rect", { x: g * u + x, y: b, width: u - 2 * x, height: F, style: { fill: P($) } }, $);
                  })
                ]
              },
              m.t
            );
          })
        ] }),
        h && /* @__PURE__ */ r(
          "div",
          {
            className: "oa-tip",
            style: s != null && s > p / 2 ? { right: 4 } : { left: 4 },
            "data-testid": "agents-timeline-tooltip",
            children: [
              /* @__PURE__ */ e("div", { style: { fontWeight: 500 }, children: xe(h.t, i) }),
              /* @__PURE__ */ r("div", { className: "oa-muted", children: [
                f(h.total),
                " spawned"
              ] }),
              h.counts.map((m, g) => m > 0 && /* @__PURE__ */ r("div", { className: "oa-tip-row", children: [
                /* @__PURE__ */ e("span", { className: "oa-swatch", style: { background: P(g), width: 8, height: 8 } }),
                /* @__PURE__ */ e("span", { className: "oa-mono", children: n[g] }),
                /* @__PURE__ */ e("b", { children: f(m) })
              ] }, g))
            ]
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ e("div", { className: "oa-tl-ticks", "aria-hidden": "true", children: o.map((m, g) => g % v === 0 && /* @__PURE__ */ e("span", { style: { left: `${g * u}%` }, children: i < Oe ? ae(m.t) : j(m.t) }, m.t)) })
  ] });
}
function Le({ run: t, onOpen: o }) {
  return /* @__PURE__ */ e(
    "button",
    {
      type: "button",
      className: "oa-name",
      onClick: (n) => {
        n.stopPropagation(), o(t);
      },
      "aria-label": `Open run ${t.name}`,
      title: t.key,
      children: t.name
    }
  );
}
function gt({ run: t }) {
  return /* @__PURE__ */ r(q, { variant: Ie[t.outcome] ?? "muted", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, children: [
    t.outcome === "running" && /* @__PURE__ */ e(H, { size: 11, className: "oa-pulse", "aria-hidden": "true" }),
    Ce(t.outcome)
  ] });
}
function ft({ stats: t, now: o }) {
  return /* @__PURE__ */ r("table", { className: "oa-table", "data-testid": "agents-type-table", children: [
    /* @__PURE__ */ e("thead", { children: /* @__PURE__ */ r("tr", { children: [
      /* @__PURE__ */ e("th", { children: "Agent" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Spawned" }),
      /* @__PURE__ */ e("th", { className: "num", children: "OK rate" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Errors" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Aborted" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Cost" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Tokens" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Median duration" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Tools / run" }),
      /* @__PURE__ */ e("th", { children: "Models" }),
      /* @__PURE__ */ e("th", { children: "Last used" })
    ] }) }),
    /* @__PURE__ */ e("tbody", { children: t.map((n, a) => /* @__PURE__ */ r("tr", { "data-testid": `agents-type-row-${n.agent}`, children: [
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ r("span", { className: "oa-inline", children: [
        /* @__PURE__ */ e("span", { className: "oa-swatch", style: { background: P(a) }, "aria-hidden": "true" }),
        /* @__PURE__ */ e("span", { className: "oa-mono", style: { color: "var(--text-strong)" }, children: n.agent }),
        n.running > 0 && /* @__PURE__ */ r(q, { variant: "aim", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, children: [
          f(n.running),
          " running"
        ] })
      ] }) }),
      /* @__PURE__ */ e("td", { className: "num", children: f(n.spawned) }),
      /* @__PURE__ */ e("td", { className: "num", children: n.okRate == null ? "—" : C(n.okRate) }),
      /* @__PURE__ */ e("td", { className: "num", style: { color: n.error > 0 ? "var(--danger)" : "var(--muted)" }, children: f(n.error) }),
      /* @__PURE__ */ e("td", { className: "num", style: { color: n.aborted > 0 ? "var(--danger)" : "var(--muted)" }, children: f(n.aborted) }),
      /* @__PURE__ */ r("td", { className: "num", children: [
        /* @__PURE__ */ e("span", { children: S(n.cost) }),
        /* @__PURE__ */ r("span", { className: "oa-muted", style: { display: "block", fontSize: 11 }, children: [
          S(n.spawned > 0 ? n.cost / n.spawned : 0),
          " / run"
        ] })
      ] }),
      /* @__PURE__ */ e("td", { className: "num", children: M(n.tokens) }),
      /* @__PURE__ */ e("td", { className: "num", children: V(n.medianDurationMs) }),
      /* @__PURE__ */ e("td", { className: "num", children: f(n.spawned > 0 ? n.tools / n.spawned : 0, { maximumFractionDigits: 1 }) }),
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ e("span", { className: "oa-models", children: n.models.slice(0, 3).map((i) => /* @__PURE__ */ e(q, { variant: "muted", className: "oa-mono", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, title: f(i.count), children: i.model }, i.model)) }) }),
      /* @__PURE__ */ e("td", { className: "oa-muted", title: G(n.lastUsed), children: Ze(n.lastUsed, { now: o }) })
    ] }, n.agent)) })
  ] });
}
function xt({ runs: t, now: o, selectedKey: n, onOpen: a }) {
  return /* @__PURE__ */ r("table", { className: "oa-table", "data-testid": "agents-running-table", children: [
    /* @__PURE__ */ e("thead", { children: /* @__PURE__ */ r("tr", { children: [
      /* @__PURE__ */ e("th", { children: "Name" }),
      /* @__PURE__ */ e("th", { children: "Agent" }),
      /* @__PURE__ */ e("th", { children: "Project" }),
      /* @__PURE__ */ e("th", { children: "Model" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Elapsed" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Cost" })
    ] }) }),
    /* @__PURE__ */ e("tbody", { children: t.map((i) => /* @__PURE__ */ r("tr", { className: "oa-click", "data-selected": i.key === n, onClick: () => a(i), "data-testid": "agents-running-row", children: [
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ r("span", { className: "oa-inline", children: [
        /* @__PURE__ */ e(H, { size: 13, className: "oa-pulse", style: { color: "var(--aim)", flex: "none" }, "aria-hidden": "true" }),
        /* @__PURE__ */ e(Le, { run: i, onOpen: a })
      ] }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono", children: i.kind === "main" ? "main session" : i.agent }),
      /* @__PURE__ */ e("td", { className: "oa-muted", children: /* @__PURE__ */ e("span", { className: "oa-trunc", title: i.project, children: i.project }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono oa-muted", children: i.model }),
      /* @__PURE__ */ e("td", { className: "num", children: V(o - i.start) }),
      /* @__PURE__ */ e("td", { className: "num", children: S(i.cost) })
    ] }, i.key)) })
  ] });
}
function vt({ runs: t, selectedKey: o, onOpen: n }) {
  return /* @__PURE__ */ r("table", { className: "oa-table", "data-testid": "agents-recent-table", children: [
    /* @__PURE__ */ e("thead", { children: /* @__PURE__ */ r("tr", { children: [
      /* @__PURE__ */ e("th", { children: "Name" }),
      /* @__PURE__ */ e("th", { children: "Agent" }),
      /* @__PURE__ */ e("th", { children: "Outcome" }),
      /* @__PURE__ */ e("th", { children: "Project" }),
      /* @__PURE__ */ e("th", { children: "Model" }),
      /* @__PURE__ */ e("th", { children: "Started" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Duration" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Tokens" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Tools" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Cost" })
    ] }) }),
    /* @__PURE__ */ e("tbody", { children: t.map((a) => /* @__PURE__ */ r("tr", { className: "oa-click", "data-selected": a.key === o, onClick: () => n(a), "data-testid": "agents-recent-row", children: [
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ e(Le, { run: a, onOpen: n }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono", children: a.agent }),
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ e(gt, { run: a }) }),
      /* @__PURE__ */ e("td", { className: "oa-muted", children: /* @__PURE__ */ e("span", { className: "oa-trunc", title: a.project, children: a.project }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono oa-muted", children: a.model }),
      /* @__PURE__ */ e("td", { className: "oa-muted", children: G(a.start) }),
      /* @__PURE__ */ e("td", { className: "num", children: V(a.duration_ms) }),
      /* @__PURE__ */ e("td", { className: "num", children: M(a.tokens) }),
      /* @__PURE__ */ e("td", { className: "num", children: f(a.tools) }),
      /* @__PURE__ */ e("td", { className: "num", children: S(a.cost) })
    ] }, a.key)) })
  ] });
}
const Q = "/apps/omp-dashboard/api", ee = 200, bt = 3e3;
function wt({ m: t }) {
  if (t.role === "tool")
    return /* @__PURE__ */ r("div", { className: "oa-msg", "data-testid": "agents-msg-tool", children: [
      /* @__PURE__ */ e(Ve, { size: 13, className: "oa-msg-icon oa-muted", "aria-label": "Tool result" }),
      /* @__PURE__ */ r("div", { className: "oa-msg-body", children: [
        /* @__PURE__ */ r("div", { className: "oa-msg-meta", children: [
          t.tool_name && /* @__PURE__ */ e("span", { className: "oa-mono", style: { color: "var(--text)" }, children: t.tool_name }),
          " · ",
          ae(t.ts)
        ] }),
        /* @__PURE__ */ e("pre", { className: "oa-tool-out", children: t.text })
      ] })
    ] });
  const o = t.role === "assistant";
  return /* @__PURE__ */ r("div", { className: "oa-msg", "data-testid": o ? "agents-msg-assistant" : "agents-msg-user", children: [
    o ? /* @__PURE__ */ e(_, { size: 13, className: "oa-msg-icon", style: { color: "var(--accent)" }, "aria-label": "Assistant" }) : /* @__PURE__ */ e(Qe, { size: 13, className: "oa-msg-icon oa-muted", "aria-label": "User" }),
    /* @__PURE__ */ r("div", { className: "oa-msg-body", children: [
      /* @__PURE__ */ e("div", { className: "oa-msg-meta", children: ae(t.ts) }),
      o ? /* @__PURE__ */ e("div", { className: "oa-msg-text", children: t.text.split(`
`).map((n, a) => n.startsWith("→ ") ? /* @__PURE__ */ r("div", { className: "oa-call", children: [
        /* @__PURE__ */ e(Xe, { size: 11, style: { verticalAlign: "-1px" }, "aria-hidden": "true" }),
        " ",
        n.slice(2)
      ] }, a) : /* @__PURE__ */ e("div", { children: n }, a)) }) : /* @__PURE__ */ e("div", { className: "oa-msg-text oa-msg-user", children: t.text })
    ] })
  ] });
}
function yt({ run: t, now: o, mobile: n, onClose: a, onOpenParent: i }) {
  const s = Y(), d = t.outcome === "running", { data: l, error: p, isLoading: u, refetch: c } = se({
    queryKey: ["omp-dashboard", "session", t.key, ee],
    queryFn: () => s.get(`${Q}/session?key=${encodeURIComponent(t.key)}&tail=${ee}`),
    refetchInterval: d ? bt : !1,
    placeholderData: tt
  }), x = O(null), v = O(!0), h = (l == null ? void 0 : l.messages.length) ?? 0;
  I(() => {
    const g = x.current;
    g && v.current && (g.scrollTop = g.scrollHeight);
  }, [h, t.key]);
  const m = (l == null ? void 0 : l.outcome) ?? t.outcome;
  return /* @__PURE__ */ r("aside", { className: `oa-drawer${n ? " oa-drawer-mobile" : ""}`, "data-testid": "agents-drawer", children: [
    /* @__PURE__ */ r("div", { className: "oa-drawer-head", children: [
      /* @__PURE__ */ e(_, { size: 16, style: { color: "var(--accent)", flex: "none" } }),
      /* @__PURE__ */ e("div", { className: "oa-drawer-title", title: t.name, children: t.name }),
      t.parent_key && /* @__PURE__ */ r("button", { type: "button", className: "oa-btn", onClick: () => i(t.parent_key), "data-testid": "agents-drawer-parent", children: [
        /* @__PURE__ */ e(Ge, { size: 13 }),
        " Parent"
      ] }),
      /* @__PURE__ */ e("button", { type: "button", className: "oa-btn", onClick: a, "aria-label": "Close", "data-testid": "agents-drawer-close", children: /* @__PURE__ */ e(Ye, { size: 13 }) })
    ] }),
    /* @__PURE__ */ r("div", { className: "oa-drawer-meta", "data-testid": "agents-drawer-meta", children: [
      /* @__PURE__ */ r(q, { variant: Ie[m] ?? "muted", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, children: [
        m === "running" && /* @__PURE__ */ e(H, { size: 11, className: "oa-pulse", "aria-hidden": "true" }),
        Ce(m)
      ] }),
      /* @__PURE__ */ e("span", { className: "oa-mono", style: { color: "var(--text)" }, children: t.kind === "main" ? "main session" : t.agent }),
      /* @__PURE__ */ e("span", { className: "oa-mono", children: t.model }),
      /* @__PURE__ */ e("span", { style: { overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }, title: t.project, children: t.project }),
      /* @__PURE__ */ e("span", { title: G(t.start), children: V(d ? o - t.start : t.duration_ms) }),
      /* @__PURE__ */ e("span", { children: S(t.cost) })
    ] }),
    /* @__PURE__ */ r(
      "div",
      {
        ref: x,
        className: "oa-transcript",
        "aria-live": d ? "polite" : void 0,
        "data-testid": "agents-drawer-transcript",
        onScroll: (g) => {
          const b = g.currentTarget;
          v.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
        },
        children: [
          p && /* @__PURE__ */ r("div", { className: "oa-error", "data-testid": "agents-drawer-error", children: [
            "Could not load this session: ",
            p instanceof Error ? p.message : String(p)
          ] }),
          u && !l && /* @__PURE__ */ e(U, { rows: 4 }),
          l && l.messages.length === 0 && !p && /* @__PURE__ */ e("div", { className: "oa-empty", children: "No messages in this session yet." }),
          l && l.messages.length >= ee && /* @__PURE__ */ r("div", { className: "oa-muted", style: { fontSize: 11, textAlign: "center" }, children: [
            "Showing the last ",
            l.messages.length,
            " messages"
          ] }),
          l == null ? void 0 : l.messages.map((g, b) => /* @__PURE__ */ e(wt, { m: g }, `${g.ts}-${b}`)),
          d && l && /* @__PURE__ */ r("div", { className: "oa-live", children: [
            /* @__PURE__ */ e(H, { size: 11, className: "oa-pulse", style: { color: "var(--aim)" }, "aria-hidden": "true" }),
            "Live · refreshing every 3 s",
            /* @__PURE__ */ e("button", { type: "button", className: "oa-btn", onClick: () => void c(), children: "Refresh" })
          ] }),
          !d && l && /* @__PURE__ */ r("div", { className: "oa-msg-meta", children: [
            f(l.messages.length),
            " messages"
          ] })
        ]
      }
    )
  ] });
}
const Nt = 15e3;
function _e(t = !0) {
  const o = Y();
  return se({
    queryKey: ["omp-dashboard", "runs"],
    queryFn: () => o.get(`${Q}/runs`),
    refetchInterval: Nt,
    enabled: t
  });
}
const Pe = "omp-dashboard-agents-window", kt = 100, ve = "(max-width: 767px)";
function St() {
  try {
    const t = localStorage.getItem(Pe);
    return Te.includes(t ?? "") ? t : ge;
  } catch {
    return ge;
  }
}
function Mt() {
  const [t, o] = k(() => window.matchMedia(ve).matches);
  return I(() => {
    const n = window.matchMedia(ve), a = () => o(n.matches);
    return n.addEventListener("change", a), () => n.removeEventListener("change", a);
  }, []), t;
}
function be({ label: t, count: o }) {
  return /* @__PURE__ */ r("div", { className: "oa-section", children: [
    t,
    /* @__PURE__ */ e("span", { className: "oa-count", children: f(o) })
  ] });
}
function At() {
  const t = Mt(), [o, n] = k(St), [a, i] = k(null), { data: s, error: d, isLoading: l, refetch: p } = _e(), u = (g) => {
    n(g);
    try {
      localStorage.setItem(Pe, g);
    } catch {
      return;
    }
  }, c = He(() => {
    if (!s) return null;
    const g = s.now, b = $e(nt(s.runs, o, g)), y = ze(s.runs);
    return {
      now: g,
      spawned: b,
      running: y,
      stats: De(b),
      kpis: rt(b, y.length),
      timeline: it(b, o, g),
      recent: [...b].sort(($, F) => F.start - $.start).slice(0, kt),
      byKey: new Map(s.runs.map(($) => [$.key, $]))
    };
  }, [s, o]), x = a && c ? c.byKey.get(a.key) ?? a : a, v = (g) => {
    const b = c == null ? void 0 : c.byKey.get(g);
    b && i(b);
  }, h = x && /* @__PURE__ */ e(yt, { run: x, now: (c == null ? void 0 : c.now) ?? Date.now(), mobile: t, onClose: () => i(null), onOpenParent: v }), m = d ? d instanceof Error ? d.message : String(d) : null;
  return t && h ? /* @__PURE__ */ e("div", { className: "oa-root", "data-testid": "agents-page", children: h }) : /* @__PURE__ */ r("div", { className: "oa-root", "data-testid": "agents-page", children: [
    /* @__PURE__ */ e("div", { className: "oa-main", children: /* @__PURE__ */ r("div", { className: "oa-body", children: [
      /* @__PURE__ */ r("div", { className: "od-toolbar", children: [
        /* @__PURE__ */ e(
          Ae,
          {
            segments: Te.map((g) => ({ key: g, label: pt[g] })),
            value: o,
            onChange: u,
            layoutId: "omp-dashboard-agents-window",
            ariaLabel: "Time window",
            collapse: !1
          }
        ),
        /* @__PURE__ */ e("span", { className: "od-note", children: "omp subagents spawned across all sessions, plus what is running now" })
      ] }),
      m && /* @__PURE__ */ r("div", { className: "oa-error", "data-testid": "agents-load-error", children: [
        "Could not load agent runs: ",
        m
      ] }),
      l && !c && /* @__PURE__ */ e(U, { rows: 6 }),
      c && /* @__PURE__ */ r(B, { children: [
        /* @__PURE__ */ r("div", { className: "oa-kpis", "data-testid": "agents-kpis", children: [
          /* @__PURE__ */ e(E, { label: "Spawned", value: f(c.kpis.spawned), "data-testid": "stat-card-spawned" }),
          /* @__PURE__ */ e(
            E,
            {
              label: "OK rate",
              value: c.kpis.okRate == null ? "—" : C(c.kpis.okRate),
              colorClass: c.kpis.okRate == null ? "" : c.kpis.okRate >= 0.9 ? "text-ok-text" : c.kpis.okRate >= 0.6 ? "text-warn-text" : "text-danger-text",
              title: "Finished runs that ended OK, over finished runs. Running runs are excluded.",
              delay: 40,
              "data-testid": "stat-card-ok-rate"
            }
          ),
          /* @__PURE__ */ e(E, { label: "Spend", value: S(c.kpis.cost), title: "API-equivalent cost of the runs in this window", delay: 80, "data-testid": "stat-card-spend" }),
          /* @__PURE__ */ e(E, { label: "Agent types", value: f(c.kpis.agentTypes), delay: 120, "data-testid": "stat-card-types" }),
          /* @__PURE__ */ e(E, { label: "Running now", value: f(c.kpis.running), accent: c.kpis.running > 0, delay: 160, "data-testid": "stat-card-running" })
        ] }),
        c.spawned.length === 0 && c.running.length === 0 ? /* @__PURE__ */ e(w, { children: /* @__PURE__ */ e(me, { icon: /* @__PURE__ */ e(_, {}), title: "No agent runs yet", subtitle: "Subagents spawned by omp in this window will show up here.", testId: "agents-empty" }) }) : /* @__PURE__ */ r(B, { children: [
          /* @__PURE__ */ r("div", { className: "oa-grid2", children: [
            /* @__PURE__ */ r(w, { children: [
              /* @__PURE__ */ e(T, { children: "Spawned by type" }),
              c.spawned.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "No runs in this window." }) : /* @__PURE__ */ e(mt, { stats: c.stats, total: c.kpis.spawned })
            ] }),
            /* @__PURE__ */ r(w, { children: [
              /* @__PURE__ */ e(T, { children: "Spawns over time" }),
              /* @__PURE__ */ e(ht, { timeline: c.timeline })
            ] })
          ] }),
          /* @__PURE__ */ r(w, { className: "oa-card-flush", children: [
            /* @__PURE__ */ e("div", { className: "oa-card-title-pad", children: /* @__PURE__ */ e(T, { children: "By agent type" }) }),
            c.stats.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "No runs in this window." }) : /* @__PURE__ */ e(ft, { stats: c.stats, now: c.now })
          ] }),
          /* @__PURE__ */ e(be, { label: "Running now", count: c.running.length }),
          /* @__PURE__ */ e(w, { className: "oa-card-flush", children: c.running.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", "data-testid": "agents-running-empty", children: "Nothing is running right now." }) : /* @__PURE__ */ e(xt, { runs: c.running, now: c.now, selectedKey: (x == null ? void 0 : x.key) ?? null, onOpen: i }) }),
          /* @__PURE__ */ e(be, { label: "Recent runs", count: c.recent.length }),
          /* @__PURE__ */ e(w, { className: "oa-card-flush", children: c.recent.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "No runs in this window." }) : /* @__PURE__ */ e(vt, { runs: c.recent, selectedKey: (x == null ? void 0 : x.key) ?? null, onOpen: i }) })
        ] })
      ] }),
      d && !c && /* @__PURE__ */ e(
        me,
        {
          icon: /* @__PURE__ */ e(_, {}),
          title: "Could not load agent runs",
          action: /* @__PURE__ */ e(je, { onClick: () => void p(), children: "Refresh" }),
          testId: "agents-error-empty"
        }
      )
    ] }) }),
    h
  ] });
}
const Tt = 0.75, Rt = 0.9, $t = 6e4;
function We(t) {
  var n;
  if (t.status === "exhausted") return 1;
  const o = (n = t.amount) == null ? void 0 : n.usedFraction;
  return typeof o == "number" && Number.isFinite(o) ? Math.max(0, o) : null;
}
function Ue(t) {
  return t == null ? "ok" : t >= Rt ? "danger" : t >= Tt ? "warn" : "ok";
}
function Fe(t) {
  const o = t.metadata;
  return o != null && o.email ? o.email : o != null && o.orgName ? o.orgName : o != null && o.accountId ? o.accountId.slice(0, 8) : null;
}
function zt(t) {
  const o = /* @__PURE__ */ new Map();
  for (const n of t ?? []) {
    let a = o.get(n.provider);
    a || (a = { provider: n.provider, accounts: [] }, o.set(n.provider, a)), a.accounts.push(n);
  }
  return [...o.values()];
}
const W = 6e4, z = 60 * W, L = 24 * z;
function Dt(t) {
  return `${Math.round(t * 100)}%`;
}
function we(t) {
  return t.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
function oe(t) {
  return t >= L ? ye([[Math.floor(t / L), "d"], [Math.floor(t % L / z), "h"]]) : t >= z ? ye([[Math.floor(t / z), "h"], [Math.floor(t % z / W), "m"]]) : `${Math.max(1, Math.floor(t / W))}m`;
}
function ye(t) {
  return t.filter(([o]) => o > 0).map(([o, n]) => `${o}${n}`).join(" ");
}
function le(t, o) {
  const n = Math.max(0, o - t);
  return n < W ? "just now" : n < z ? `${Math.floor(n / W)}m ago` : n < L ? `${Math.floor(n / z)}h ago` : `${Math.floor(n / L)}d ago`;
}
function It(t, o) {
  const n = [];
  for (const a of t ?? []) {
    const i = Fe(a);
    for (const s of a.limits ?? []) {
      const d = We(s);
      d != null && n.push({ key: `${a.provider}/${i ?? ""}/${s.id}`, provider: a.provider, account: i, limit: s, fraction: d });
    }
  }
  return n.sort((a, i) => i.fraction - a.fraction).slice(0, o);
}
const Ct = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, Et = {
  ok: "var(--text)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, A = { color: "var(--muted)" }, re = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, Ne = { animation: "omp-usage-spin 1s linear infinite" }, Ot = "@keyframes omp-usage-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[data-omp-usage-spin]{animation:none!important}}";
function Lt({ limit: t, now: o, compact: n }) {
  var h;
  const a = We(t), i = Ue(a), s = a == null ? 0 : Math.min(100, Math.round(a * 100)), d = t.amount, l = (d == null ? void 0 : d.used) != null && d.limit != null && d.unit !== "percent", p = (h = t.window) == null ? void 0 : h.resetsAt, u = p != null && p > o, c = p == null ? "" : u ? `↻ ${oe(p - o)}` : "Resets momentarily", x = l ? `${we(d.used)} / ${we(d.limit)} ${d.unit ?? ""}`.trim() : "", v = n ? "minmax(0,1fr) 48px 38px 64px" : "minmax(0,1fr) 120px 48px 76px";
  return /* @__PURE__ */ r(
    "li",
    {
      "data-testid": "omp-usage-limit",
      title: u ? `Resets in ${oe(p - o)}` : void 0,
      style: { display: "grid", gridTemplateColumns: v, alignItems: "center", columnGap: 12, padding: "4px 0" },
      children: [
        /* @__PURE__ */ r("span", { style: { minWidth: 0, display: "flex", flexDirection: "column" }, children: [
          /* @__PURE__ */ e("span", { style: { ...re, fontSize: 13, color: "var(--text)" }, children: t.label }),
          x && /* @__PURE__ */ e("span", { style: { ...A, ...re, fontSize: 11, fontVariantNumeric: "tabular-nums" }, children: x })
        ] }),
        /* @__PURE__ */ e(
          "span",
          {
            role: "progressbar",
            "aria-label": t.label,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": s,
            "data-severity": i,
            style: { height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden" },
            children: /* @__PURE__ */ e("span", { style: { display: "block", height: "100%", width: `${s}%`, background: Ct[i], borderRadius: 4 } })
          }
        ),
        /* @__PURE__ */ e("span", { style: { fontSize: 13, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", color: Et[i] }, children: a == null ? "—" : Dt(a) }),
        /* @__PURE__ */ e("span", { style: { ...A, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, children: c })
      ]
    }
  );
}
function _t({ report: t, now: o, compact: n }) {
  var d;
  const a = Fe(t), i = (d = t.metadata) == null ? void 0 : d.planType, s = t.limits ?? [];
  return /* @__PURE__ */ r(
    "div",
    {
      "data-testid": "omp-usage-account",
      style: { display: "flex", flexDirection: "column", gap: 6, borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "10px 12px" },
      children: [
        /* @__PURE__ */ r("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [
          a && /* @__PURE__ */ e("span", { title: a, style: { ...re, fontSize: 13, fontWeight: 600, color: "var(--text)" }, children: a }),
          i && /* @__PURE__ */ e("span", { style: { ...A, flexShrink: 0, fontSize: 10.5, padding: "0 6px", borderRadius: 4, border: "1px solid var(--border)" }, children: i }),
          t.fetchedAt != null && /* @__PURE__ */ e("span", { style: { ...A, marginLeft: "auto", flexShrink: 0, fontSize: 11 }, children: le(t.fetchedAt, o) })
        ] }),
        s.length === 0 ? /* @__PURE__ */ e("p", { style: { ...A, margin: 0, fontSize: 12 }, children: "No usage data" }) : /* @__PURE__ */ e("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }, children: s.map((l) => /* @__PURE__ */ e(Lt, { limit: l, now: o, compact: n }, l.id)) })
      ]
    }
  );
}
function Pt({ data: t, error: o, loading: n, refreshing: a, onRefresh: i, compact: s = !1, now: d = Date.now() }) {
  const l = zt(t == null ? void 0 : t.reports), p = o ?? (t && !t.ok ? t.error ?? "OMP usage is unavailable." : null);
  return /* @__PURE__ */ r("div", { "data-testid": "omp-usage-panel", style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ e("style", { children: Ot }),
    /* @__PURE__ */ r("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: s ? "10px 12px" : "0 0 12px", borderBottom: s ? "1px solid var(--border)" : void 0 }, children: [
      s && /* @__PURE__ */ e("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--text)" }, children: "OMP usage" }),
      t != null && t.fetchedAt ? /* @__PURE__ */ r("span", { style: { ...A, fontSize: 11.5 }, children: [
        "Fetched ",
        le(t.fetchedAt, d)
      ] }) : null,
      /* @__PURE__ */ e(
        "button",
        {
          type: "button",
          "aria-label": "Refresh usage",
          title: "Refresh usage",
          onClick: i,
          disabled: a,
          style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: a ? "default" : "pointer" },
          children: a ? /* @__PURE__ */ e(he, { size: 13, style: Ne, "data-omp-usage-spin": "" }) : /* @__PURE__ */ e(Je, { size: 13 })
        }
      )
    ] }),
    /* @__PURE__ */ r("div", { style: { display: "flex", flexDirection: "column", gap: 16, padding: s ? 12 : "12px 0", maxHeight: s ? "min(70vh, 520px)" : void 0, overflowY: s ? "auto" : void 0 }, children: [
      p && /* @__PURE__ */ r("div", { role: "alert", style: { borderRadius: 8, padding: "10px 12px", background: "var(--danger-subtle)", border: "1px solid var(--danger)", color: "var(--text)", fontSize: 12.5 }, children: [
        /* @__PURE__ */ e("strong", { style: { display: "block", marginBottom: 2 }, children: "Couldn't load OMP usage" }),
        p
      ] }),
      n && !t && /* @__PURE__ */ r("div", { role: "status", style: { ...A, display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }, children: [
        /* @__PURE__ */ e(he, { size: 13, style: Ne, "data-omp-usage-spin": "", "aria-hidden": "true" }),
        "Loading usage…"
      ] }),
      t && l.length === 0 && !p && /* @__PURE__ */ e("p", { style: { ...A, margin: 0, fontSize: 11.5 }, children: "No accounts reported usage." }),
      l.map((u) => /* @__PURE__ */ r("section", { "data-testid": "omp-usage-provider", style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
        /* @__PURE__ */ r("h3", { style: { ...A, margin: 0, display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }, children: [
          /* @__PURE__ */ e("span", { children: u.provider }),
          /* @__PURE__ */ r("span", { style: { fontWeight: 400, textTransform: "none", letterSpacing: "normal" }, children: [
            "· ",
            u.accounts.length
          ] })
        ] }),
        u.accounts.map((c, x) => {
          var v, h;
          return /* @__PURE__ */ e(_t, { report: c, now: d, compact: s }, `${((v = c.metadata) == null ? void 0 : v.accountId) ?? ((h = c.metadata) == null ? void 0 : h.email) ?? ""}:${x}`);
        })
      ] }, u.provider))
    ] })
  ] });
}
function Wt({ state: t }) {
  return /* @__PURE__ */ e("div", { className: "od-scroll", "data-testid": "limits-tab", children: /* @__PURE__ */ e("div", { style: { maxWidth: 720 }, children: /* @__PURE__ */ e(Pt, { data: t.data, error: t.error, loading: t.loading, refreshing: t.refreshing, onRefresh: t.refresh }) }) });
}
const de = ["24h", "3d", "7d", "30d"], ce = "24h", Ut = {
  "24h": "24 hours",
  "3d": "3 days",
  "7d": "7 days",
  "30d": "30 days"
}, X = "API-equivalent: what these tokens would cost at list price. Subscription accounts aren't billed this.";
function Ft(t) {
  return de.includes(t ?? "");
}
function Bt({ windows: t, selected: o, onSelect: n }) {
  return /* @__PURE__ */ e("div", { className: "od-tiles", "data-testid": "spend-tiles", children: de.map((a) => {
    const i = t[a];
    return /* @__PURE__ */ r(
      "button",
      {
        type: "button",
        className: "od-tile",
        "data-selected": o === a,
        "data-testid": `spend-tile-${a}`,
        title: X,
        onClick: () => n(a),
        children: [
          /* @__PURE__ */ e("span", { className: "od-tile-label", children: Ut[a] }),
          /* @__PURE__ */ e("span", { className: "od-tile-cost", children: Ee(i.cost) }),
          /* @__PURE__ */ r("span", { className: "od-tile-sub", children: [
            f(i.requests),
            " requests · ",
            M(i.tokens),
            " tokens"
          ] })
        ]
      },
      a
    );
  }) });
}
function Be({ inline: t = !1 }) {
  return /* @__PURE__ */ e("div", { className: t ? "od-note" : "od-note od-note-block", title: X, children: "API-equivalent cost · list price, not billed on subscription accounts" });
}
function qt({ daily: t }) {
  const o = Math.max(...t.map((a) => a.cost), 0), n = t.length - 1;
  return /* @__PURE__ */ r("div", { className: "od-strip", "data-testid": "spend-daily", role: "img", "aria-label": "Daily API-equivalent spend, last 14 days", children: [
    /* @__PURE__ */ e("div", { className: "od-strip-bars", children: t.map((a, i) => /* @__PURE__ */ e(
      "div",
      {
        className: "od-strip-col",
        title: `${j(`${a.date}T12:00:00`)} · ${S(a.cost)} · ${f(a.requests)} requests`,
        children: /* @__PURE__ */ e(
          "div",
          {
            className: "od-strip-bar",
            "data-today": i === n,
            "data-testid": "spend-daily-bar",
            style: { height: `${o > 0 ? Math.max(a.cost > 0 ? 3 : 0, a.cost / o * 100) : 0}%` }
          }
        )
      },
      a.date
    )) }),
    /* @__PURE__ */ r("div", { className: "od-strip-axis", children: [
      /* @__PURE__ */ e("span", { children: j(`${t[0].date}T12:00:00`) }),
      /* @__PURE__ */ r("span", { children: [
        "peak ",
        Ee(o)
      ] }),
      /* @__PURE__ */ e("span", { children: "today" })
    ] })
  ] });
}
function Ht({ share: t }) {
  return /* @__PURE__ */ r("span", { className: "od-share", children: [
    /* @__PURE__ */ e("span", { className: "od-share-track", children: /* @__PURE__ */ e("span", { className: "od-share-fill", style: { width: `${Math.min(100, Math.max(0, t * 100))}%` } }) }),
    /* @__PURE__ */ e("span", { className: "od-share-pct", children: C(t) })
  ] });
}
function te({ rows: t, nameLabel: o, testId: n }) {
  return t.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "No requests in this window." }) : /* @__PURE__ */ r("table", { className: "oa-table", "data-testid": n, children: [
    /* @__PURE__ */ e("thead", { children: /* @__PURE__ */ r("tr", { children: [
      /* @__PURE__ */ e("th", { children: o }),
      /* @__PURE__ */ e("th", { className: "num", title: X, children: "Cost" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Requests" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Tokens" }),
      /* @__PURE__ */ e("th", { children: "Share" })
    ] }) }),
    /* @__PURE__ */ e("tbody", { children: t.map((a) => /* @__PURE__ */ r("tr", { children: [
      /* @__PURE__ */ r("td", { children: [
        /* @__PURE__ */ e("span", { className: "oa-trunc", title: a.provider ? `${a.provider} / ${a.name}` : a.name, children: a.name }),
        a.provider && /* @__PURE__ */ e("span", { className: "oa-muted od-sub", children: a.provider })
      ] }),
      /* @__PURE__ */ e("td", { className: "num", children: S(a.cost) }),
      /* @__PURE__ */ e("td", { className: "num", children: f(a.requests) }),
      /* @__PURE__ */ e("td", { className: "num", children: M(a.tokens) }),
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ e(Ht, { share: a.share }) })
    ] }, `${a.provider ?? ""}/${a.name}`)) })
  ] });
}
function jt({ summary: t }) {
  const o = [
    { label: "API-equivalent cost", value: S(t.cost), hint: X },
    { label: "Requests", value: f(t.requests), hint: `${f(t.errors)} ended in an error` },
    { label: "Tokens", value: M(t.tokens), hint: `${M(t.inputTokens)} input · ${M(t.outputTokens)} output · ${M(t.cacheReadTokens)} cache read · ${M(t.cacheWriteTokens)} cache write` },
    { label: "Cache hit rate", value: t.cacheHitRate == null ? "—" : C(t.cacheHitRate), hint: "Cache-read tokens over all prompt tokens (input + cache read + cache write)" },
    { label: "Avg TTFT", value: ut(t.avgTtftMs), hint: "Mean time to first token" },
    { label: "Tokens / s", value: t.tokensPerSecond == null ? "—" : f(t.tokensPerSecond, { maximumFractionDigits: 0 }), hint: "Output tokens over generation time, summed across requests" },
    { label: "Errors", value: f(t.errors), hint: 'Requests whose stop reason is "error"' }
  ];
  return /* @__PURE__ */ e("div", { className: "od-stats", "data-testid": "spend-stats", children: o.map((n) => /* @__PURE__ */ r("div", { className: "od-stat", title: n.hint, children: [
    /* @__PURE__ */ e("div", { className: "od-stat-label", children: n.label }),
    /* @__PURE__ */ e("div", { className: "od-stat-value", children: n.value })
  ] }, n.label)) });
}
function Kt({ payload: t }) {
  return /* @__PURE__ */ e("div", { className: "oa-empty", "data-testid": "spend-unavailable", children: t != null && t.error ? `Could not read omp's stats database: ${t.error}` : "omp has no stats database here yet, so there is no spend to show." });
}
const Gt = 6e4;
function pe(t, o = !0) {
  const n = Y();
  return se({
    queryKey: ["omp-dashboard", "spend", t],
    queryFn: () => n.get(`${Q}/spend?window=${t}`),
    refetchInterval: Gt,
    enabled: o
  });
}
const Yt = 5, Vt = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)" }, Qt = { ok: "var(--text)", warn: "var(--warn)", danger: "var(--danger)" };
function Xt({ usage: t, now: o, onOpen: n }) {
  const a = It(t == null ? void 0 : t.reports, Yt);
  return /* @__PURE__ */ r(w, { children: [
    /* @__PURE__ */ r("div", { className: "od-card-head", children: [
      /* @__PURE__ */ e(T, { children: "Limits to watch" }),
      /* @__PURE__ */ e("button", { type: "button", className: "od-link", onClick: n, "data-testid": "overview-open-limits", children: "All limits →" })
    ] }),
    a.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: t ? t.ok ? "No limits reported." : t.error ?? "OMP usage is unavailable." : "Loading limits…" }) : /* @__PURE__ */ e("ul", { className: "od-watch", "data-testid": "overview-limits", children: a.map((i) => {
      var p;
      const s = Ue(i.fraction), d = (p = i.limit.window) == null ? void 0 : p.resetsAt, l = Math.min(100, Math.round(i.fraction * 100));
      return /* @__PURE__ */ e("li", { children: /* @__PURE__ */ r("button", { type: "button", className: "od-watch-row", onClick: n, children: [
        /* @__PURE__ */ r("span", { className: "od-watch-name", children: [
          /* @__PURE__ */ e("span", { className: "oa-trunc", children: i.limit.label }),
          /* @__PURE__ */ e("span", { className: "oa-muted od-sub", children: i.account ?? i.provider })
        ] }),
        /* @__PURE__ */ e("span", { className: "od-watch-track", role: "progressbar", "aria-label": i.limit.label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": l, children: /* @__PURE__ */ e("span", { style: { width: `${l}%`, background: Vt[s] } }) }),
        /* @__PURE__ */ e("span", { className: "od-watch-pct", style: { color: Qt[s] }, children: C(i.fraction) }),
        /* @__PURE__ */ e("span", { className: "oa-muted od-watch-reset", children: d == null ? "" : d > o ? `↻ ${oe(d - o)}` : "resets now" })
      ] }) }, i.key);
    }) }),
    t != null && t.fetchedAt ? /* @__PURE__ */ r("div", { className: "oa-muted od-foot", children: [
      "Fetched ",
      le(t.fetchedAt, o)
    ] }) : null
  ] });
}
function Jt({ onOpen: t }) {
  const { data: o, error: n } = _e(), a = o ? ct(o.runs, o.now) : null;
  return /* @__PURE__ */ r(w, { children: [
    /* @__PURE__ */ r("div", { className: "od-card-head", children: [
      /* @__PURE__ */ e(T, { children: "Agents" }),
      /* @__PURE__ */ e("button", { type: "button", className: "od-link", onClick: t, "data-testid": "overview-open-agents", children: "All agents →" })
    ] }),
    a ? /* @__PURE__ */ r("div", { className: "od-agents-row", "data-testid": "overview-agents", children: [
      /* @__PURE__ */ r("div", { className: "od-agents-kpi", children: [
        /* @__PURE__ */ r("span", { className: "od-agents-n", "data-active": a.running > 0, children: [
          a.running > 0 && /* @__PURE__ */ e(_, { size: 16, className: "oa-pulse", "aria-hidden": "true" }),
          " ",
          f(a.running)
        ] }),
        /* @__PURE__ */ e("span", { className: "oa-muted", children: "running now" })
      ] }),
      /* @__PURE__ */ r("div", { className: "od-agents-kpi", children: [
        /* @__PURE__ */ e("span", { className: "od-agents-n", children: f(a.runs) }),
        /* @__PURE__ */ e("span", { className: "oa-muted", children: "subagent runs today" })
      ] }),
      /* @__PURE__ */ r("div", { className: "od-agents-kpi", title: "API-equivalent cost of today's subagent runs", children: [
        /* @__PURE__ */ e("span", { className: "od-agents-n", children: S(a.cost) }),
        /* @__PURE__ */ e("span", { className: "oa-muted", children: "subagent cost today" })
      ] })
    ] }) : n ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "Could not load agent runs." }) : /* @__PURE__ */ e(U, { rows: 1 })
  ] });
}
function Zt({ usage: t, now: o, onOpenTab: n, onOpenSpend: a }) {
  const s = pe(ce).data;
  return /* @__PURE__ */ r("div", { className: "od-scroll", "data-testid": "overview-tab", children: [
    s != null && s.available && s.windows && s.daily ? /* @__PURE__ */ r(B, { children: [
      /* @__PURE__ */ e(Bt, { windows: s.windows, onSelect: a }),
      /* @__PURE__ */ e(Be, {}),
      /* @__PURE__ */ r(w, { children: [
        /* @__PURE__ */ e(T, { children: "Daily spend · last 14 days" }),
        /* @__PURE__ */ e(qt, { daily: s.daily })
      ] })
    ] }) : s != null && s.error ? /* @__PURE__ */ r("div", { className: "oa-error", children: [
      "Could not read omp's stats database: ",
      s.error
    ] }) : s ? null : /* @__PURE__ */ e(U, { rows: 3 }),
    /* @__PURE__ */ r("div", { className: "od-grid2", children: [
      /* @__PURE__ */ e(Xt, { usage: t, now: o, onOpen: () => n("limits") }),
      /* @__PURE__ */ e(Jt, { onOpen: () => n("agents") })
    ] })
  ] });
}
function ea({ window: t, onWindow: o }) {
  const { data: n, error: a } = pe(t), i = a ? a instanceof Error ? a.message : String(a) : null;
  return /* @__PURE__ */ r("div", { className: "od-scroll", "data-testid": "spend-tab", children: [
    /* @__PURE__ */ r("div", { className: "od-toolbar", children: [
      /* @__PURE__ */ e(
        Ae,
        {
          segments: de.map((s) => ({ key: s, label: s })),
          value: t,
          onChange: o,
          layoutId: "omp-dashboard-spend-window",
          ariaLabel: "Spend window",
          collapse: !1
        }
      ),
      /* @__PURE__ */ e(Be, { inline: !0 })
    ] }),
    i && /* @__PURE__ */ r("div", { className: "oa-error", children: [
      "Could not load spend: ",
      i
    ] }),
    !n && !i && /* @__PURE__ */ e(U, { rows: 6 }),
    n && !(n.available && n.summary) && /* @__PURE__ */ e(Kt, { payload: n }),
    (n == null ? void 0 : n.available) && n.summary && /* @__PURE__ */ r(B, { children: [
      /* @__PURE__ */ e(jt, { summary: n.summary }),
      /* @__PURE__ */ r("div", { className: "od-grid-even", children: [
        /* @__PURE__ */ r(w, { className: "oa-card-flush", children: [
          /* @__PURE__ */ e("div", { className: "oa-card-title-pad", children: /* @__PURE__ */ e(T, { children: "By provider" }) }),
          /* @__PURE__ */ e(te, { rows: n.byProvider ?? [], nameLabel: "Provider", testId: "spend-by-provider" })
        ] }),
        /* @__PURE__ */ r(w, { className: "oa-card-flush", children: [
          /* @__PURE__ */ e("div", { className: "oa-card-title-pad", children: /* @__PURE__ */ e(T, { children: "By agent type" }) }),
          /* @__PURE__ */ e(te, { rows: n.byAgentType ?? [], nameLabel: "Agent type", testId: "spend-by-agent-type" })
        ] })
      ] }),
      /* @__PURE__ */ r(w, { className: "oa-card-flush", children: [
        /* @__PURE__ */ e("div", { className: "oa-card-title-pad", children: /* @__PURE__ */ e(T, { children: "By model" }) }),
        /* @__PURE__ */ e(te, { rows: n.byModel ?? [], nameLabel: "Model", testId: "spend-by-model" })
      ] })
    ] })
  ] });
}
const ke = `${Q}/usage`;
function ta() {
  const t = Y(), o = O(t);
  o.current = t;
  const { active: n } = et(), a = n !== !1, [i, s] = k(), [d, l] = k(null), [p, u] = k(!0), [c, x] = k(!1), v = O(!0), h = O(!1);
  I(() => (v.current = !0, () => {
    v.current = !1;
  }), []);
  const m = ue(async (b) => {
    try {
      const y = await o.current.get(b ? `${ke}?refresh=1` : ke);
      if (!v.current) return;
      s(y), l(null);
    } catch (y) {
      v.current && l(y instanceof Error ? y.message : String(y));
    } finally {
      v.current && u(!1);
    }
  }, []), g = ue(() => {
    h.current || (h.current = !0, x(!0), m(!0).finally(() => {
      h.current = !1, v.current && x(!1);
    }));
  }, [m]);
  return I(() => {
    if (!a) return;
    m(!1).then(() => g());
    const b = setInterval(() => {
      m(!1);
    }, $t);
    return () => clearInterval(b);
  }, [a, m, g]), { data: i, error: d, loading: p, refreshing: c, refresh: g };
}
const aa = `
.oa-root { display: flex; flex: 1; height: 100%; min-height: 0; min-width: 0; overflow: hidden; color: var(--text); font-family: var(--font-body, inherit); }
.oa-main { flex: 1; min-width: 0; overflow-y: auto; }
.oa-body { padding: 16px 24px 24px; }
.oa-kpis { display: grid; gap: 12px; margin-bottom: 16px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.oa-grid2 { display: grid; gap: 16px; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); margin-bottom: 16px; }
@media (max-width: 1024px) { .oa-grid2 { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) { .oa-body { padding: 0 16px 16px; } }
.oa-section { display: flex; align-items: center; gap: 8px; margin: 20px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.oa-count { padding: 0 7px; border-radius: 999px; background: var(--bg-hover); font-variant-numeric: tabular-nums; }
.oa-card-flush { padding-left: 0 !important; padding-right: 0 !important; overflow-x: auto; }
.oa-card-title-pad { padding: 0 20px; }
.oa-muted { color: var(--muted); }
.oa-mono { font-family: var(--mono, ui-monospace, monospace); }
.oa-empty { padding: 24px 0; text-align: center; font-size: 13px; color: var(--muted); }
.oa-error { margin-bottom: 16px; padding: 10px 14px; border: 1px solid var(--danger); border-radius: 8px; background: var(--danger-subtle); color: var(--danger); font-size: 13px; }

.oa-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.oa-table th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); white-space: nowrap; }
.oa-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; }
.oa-table tbody tr:last-child td { border-bottom: 0; }
.oa-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.oa-table tr.oa-click { cursor: pointer; }
.oa-table tr.oa-click:hover td { background: var(--bg-hover); }
.oa-table tr[data-selected='true'] td { background: var(--accent-subtle); }
.oa-trunc { display: block; max-width: 224px; overflow: hidden; text-overflow: ellipsis; }
.oa-name { display: block; max-width: 288px; overflow: hidden; text-overflow: ellipsis; padding: 0; border: 0; background: none; color: var(--text-strong); font: inherit; font-weight: 500; text-align: left; cursor: pointer; }
.oa-name:hover { color: var(--accent); }
.oa-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex: none; }
.oa-inline { display: inline-flex; align-items: center; gap: 8px; }
.oa-models { display: flex; flex-wrap: wrap; gap: 4px; max-width: 256px; }
.oa-pulse { animation: oa-pulse 1.4s ease-in-out infinite; }
@keyframes oa-pulse { 50% { opacity: .35; } }

.oa-donut { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; min-width: 0; }
.oa-donut-ring { position: relative; flex: none; }
.oa-donut-ring svg { width: 128px; height: 128px; transform: rotate(-90deg); }
.oa-donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
.oa-donut-total { font-size: 24px; font-weight: 700; line-height: 1; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.oa-donut-label { margin-top: 4px; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--muted); }
.oa-legend { display: flex; flex: 1; min-width: 176px; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 12px; }
.oa-legend li { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0 -4px; padding: 0 4px; border-radius: 4px; }
.oa-legend li[data-hover='true'] { background: var(--bg-hover); }
.oa-legend .oa-legend-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oa-legend .oa-legend-n { margin-left: auto; padding-left: 12px; color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }

.oa-tl { display: flex; gap: 8px; min-width: 0; }
.oa-tl-axis { position: relative; width: 24px; flex: none; text-align: right; font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.oa-tl-axis span { position: absolute; right: 0; line-height: 1; }
.oa-tl-plot { position: relative; flex: 1; min-width: 0; }
.oa-tl-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.oa-tl-ticks { position: relative; height: 14px; margin: 4px 0 0 32px; font-size: 10px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.oa-tl-ticks span { position: absolute; top: 0; }
.oa-tip { position: absolute; top: 4px; z-index: 10; max-width: 100%; padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); box-shadow: var(--shadow-lg); font-size: 11px; white-space: nowrap; pointer-events: none; }
.oa-tip-row { display: flex; align-items: center; gap: 6px; }
.oa-tip-row b { margin-left: auto; padding-left: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }

.oa-drawer { display: flex; flex: none; flex-direction: column; width: 520px; max-width: 100%; min-height: 0; border-left: 1px solid var(--border); background: var(--panel, var(--bg)); }
.oa-drawer-mobile { width: 100%; border-left: 0; }
.oa-drawer-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.oa-drawer-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--text-strong); }
.oa-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
.oa-btn:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.oa-drawer-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); }
.oa-transcript { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 12px; padding: 12px 16px; overflow-y: auto; }
.oa-msg { display: flex; gap: 8px; min-width: 0; }
.oa-msg-icon { flex: none; margin-top: 3px; }
.oa-msg-body { flex: 1; min-width: 0; }
.oa-msg-meta { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.oa-msg-text { margin-top: 2px; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.oa-msg-user { padding: 6px 8px; border-radius: 6px; background: var(--accent-subtle); }
.oa-call { font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; color: var(--muted-strong, var(--muted)); }
.oa-tool-out { margin: 2px 0 0; padding: 6px 8px; max-height: 192px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
.oa-live { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.oa-live .oa-btn { margin-left: auto; padding: 0 6px; font-size: 11px; }

.od-root { display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; min-width: 0; color: var(--text); font-family: var(--font-body, inherit); }
.od-tabs { display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid var(--border); }
.od-tab { position: relative; padding: 8px 14px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font: inherit; font-size: 14px; cursor: pointer; }
.od-tab:hover { color: var(--text); }
.od-tab[aria-selected='true'] { color: var(--text-strong); border-bottom-color: var(--accent); font-weight: 600; }
.od-content { display: flex; flex: 1; min-height: 0; min-width: 0; }
.od-scroll { flex: 1; min-width: 0; overflow-y: auto; padding: 16px 24px 32px; }
.od-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 16px; }
.od-note { color: var(--muted); font-size: 12px; }
.od-sub { display: block; max-width: 224px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.od-grid-even { display: grid; gap: 16px; margin-bottom: 16px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
.od-grid2 { display: grid; gap: 16px; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
@media (max-width: 1024px) { .od-grid2, .od-grid-even { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) { .od-scroll { padding: 12px 16px 24px; } .od-tabs { padding: 0 16px; overflow-x: auto; } }
.od-tiles { display: grid; gap: 12px; margin-bottom: 8px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.od-tile { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); box-shadow: inset 0 1px 0 var(--card-hl); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.od-tile:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.od-tile[data-selected='true'] { border-color: var(--accent); background: var(--accent-subtle); }
.od-tile-label { font-size: 12px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.od-tile-cost { font-size: 26px; font-weight: 700; line-height: 1.1; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.od-tile-sub { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.od-note-block { margin: 0 0 16px; }
.od-strip { display: flex; flex-direction: column; gap: 6px; }
.od-strip-bars { display: flex; align-items: flex-end; gap: 6px; height: 96px; }
.od-strip-col { display: flex; flex: 1; align-items: flex-end; height: 100%; min-width: 0; border-radius: 3px; }
.od-strip-col:hover { background: var(--bg-hover); }
.od-strip-bar { width: 100%; border-radius: 3px 3px 0 0; background: var(--ctx-src-memory, var(--accent)); }
.od-strip-bar[data-today='true'] { background: var(--accent); }
.od-strip-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.od-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.od-link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; }
.od-link:hover { text-decoration: underline; }
.od-watch { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.od-watch-row { display: grid; grid-template-columns: minmax(0, 1fr) 96px 44px 68px; align-items: center; column-gap: 12px; width: 100%; padding: 6px 4px; border: 0; border-radius: 6px; background: none; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.od-watch-row:hover { background: var(--bg-hover); }
.od-watch-name { display: flex; flex-direction: column; min-width: 0; }
.od-watch-track { display: block; height: 8px; border-radius: 4px; background: var(--bg-hover); overflow: hidden; }
.od-watch-track span { display: block; height: 100%; border-radius: 4px; }
.od-watch-pct { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.od-watch-reset { font-size: 11.5px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.od-foot { margin-top: 8px; font-size: 11px; }
.od-agents-row { display: flex; flex-wrap: wrap; gap: 12px 28px; }
.od-agents-kpi { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.od-agents-n { display: inline-flex; align-items: center; gap: 6px; font-size: 24px; font-weight: 700; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.od-agents-n[data-active='true'] { color: var(--accent); }
.od-stats { display: grid; gap: 12px; margin-bottom: 16px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.od-stat { padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); }
.od-stat-label { font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.od-stat-value { margin-top: 4px; font-size: 20px; font-weight: 700; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.od-share { display: inline-flex; align-items: center; gap: 8px; min-width: 108px; }
.od-share-track { flex: 1; height: 6px; border-radius: 3px; background: var(--bg-hover); overflow: hidden; }
.od-share-fill { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
.od-share-pct { width: 36px; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
`, ie = [
  { key: "overview", label: "Overview" },
  { key: "spend", label: "Spend" },
  { key: "limits", label: "Limits" },
  { key: "agents", label: "Agents" }
];
function na(t) {
  var o;
  return ((o = ie.find((n) => n.key === t)) == null ? void 0 : o.key) ?? "overview";
}
function Se() {
  const t = new URLSearchParams(location.search), o = t.get("window");
  return { tab: na(t.get("tab")), window: Ft(o) ? o : ce };
}
function Me(t, o) {
  const n = new URLSearchParams(location.search);
  n.set("tab", t), t === "spend" ? n.set("window", o) : n.delete("window"), history.replaceState(history.state, "", `${location.pathname}?${n}${location.hash}`);
}
function ca() {
  const [{ tab: t, window: o }, n] = k(Se), a = ta(), i = pe(ce), s = !!i.data && !i.data.available && !i.data.error, d = s ? ie.filter((u) => u.key !== "spend") : ie, l = t === "spend" && s ? "overview" : t;
  I(() => {
    const u = () => n(Se());
    return window.addEventListener("popstate", u), () => window.removeEventListener("popstate", u);
  }, []);
  const p = (u, c = o) => {
    n({ tab: u, window: c }), Me(u, c);
  };
  return I(() => {
    Me(l, o);
  }, [l, o]), /* @__PURE__ */ r("div", { className: "od-root", "data-testid": "omp-dashboard", children: [
    /* @__PURE__ */ e("style", { children: aa }),
    /* @__PURE__ */ e(Ke, { title: "OMP Dashboard", subtitle: "Spend, limits and agents for the omp coding agent" }),
    /* @__PURE__ */ e("div", { className: "od-tabs", role: "tablist", "aria-label": "OMP Dashboard sections", children: d.map((u) => /* @__PURE__ */ e(
      "button",
      {
        type: "button",
        role: "tab",
        id: `od-tab-${u.key}`,
        "aria-selected": u.key === l,
        "aria-controls": "od-panel",
        className: "od-tab",
        "data-testid": `tab-${u.key}`,
        onClick: () => p(u.key),
        children: u.label
      },
      u.key
    )) }),
    /* @__PURE__ */ r("div", { className: "od-content", id: "od-panel", role: "tabpanel", "aria-labelledby": `od-tab-${l}`, children: [
      l === "overview" && /* @__PURE__ */ e(
        Zt,
        {
          usage: a.data,
          now: Date.now(),
          onOpenTab: (u) => p(u),
          onOpenSpend: (u) => p("spend", u)
        }
      ),
      l === "spend" && /* @__PURE__ */ e(ea, { window: o, onWindow: (u) => p("spend", u) }),
      l === "limits" && /* @__PURE__ */ e(Wt, { state: a }),
      l === "agents" && /* @__PURE__ */ e(At, {})
    ] })
  ] });
}
export {
  ca as default
};
