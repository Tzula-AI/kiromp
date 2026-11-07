import { jsxs as s, jsx as e, Fragment as j } from "react/jsx-runtime";
import { useState as D, useId as ge, useRef as H, useEffect as Z, useMemo as fe } from "react";
import { useQuery as ee, keepPreviousData as xe } from "@tanstack/react-query";
import { Activity as C, Bot as E, ArrowUpLeft as ve, X as we, Wrench as be, User as ye, Terminal as Ne } from "lucide-react";
import { activeLocale as P, fmtNumber as f, fmtTime as B, fmtDate as te, fmtDateTime as O, fmtRelative as ke, useAppApi as ae } from "@kirocrew/app-sdk";
import { Badge as I, ContentSkeleton as ne, PageHeader as Se, SegmentedControl as Me, StatCard as R, Card as S, EmptyState as q, CardTitle as L, Btn as ze } from "@kirocrew/app-sdk/ui";
const oe = "/apps/omp-agents/api", se = ["1h", "3h", "6h", "12h", "24h", "7d", "30d", "all"], G = "24h", M = 36e5, b = 24 * M, re = {
  "1h": M,
  "3h": 3 * M,
  "6h": 6 * M,
  "12h": 12 * M,
  "24h": b,
  "7d": 7 * b,
  "30d": 30 * b,
  all: null
};
function Te(t, o) {
  switch (t) {
    case "1h":
    case "3h":
      return 10 * 6e4;
    case "6h":
      return 15 * 6e4;
    case "12h":
      return 30 * 6e4;
    case "24h":
      return M;
    case "7d":
    case "30d":
      return b;
    case "all":
      return o > 60 * b ? 7 * b : b;
  }
}
function Re(t, o, a) {
  const n = re[o];
  if (n == null) return [...t];
  const r = a - n;
  return t.filter((c) => c.start >= r);
}
function De(t) {
  return t.filter((o) => o.kind === "subagent");
}
function Ae(t) {
  if (t.length === 0) return null;
  const o = [...t].sort((n, r) => n - r), a = o.length >> 1;
  return o.length % 2 ? o[a] : (o[a - 1] + o[a]) / 2;
}
function Ce(t) {
  return t.filter((o) => o.outcome === "running").sort((o, a) => a.last_activity - o.last_activity);
}
function Ee(t, o) {
  let a = 0, n = 0, r = 0;
  const c = /* @__PURE__ */ new Set();
  for (const d of t)
    c.add(d.agent), r += d.cost, d.outcome !== "running" && (n += 1, d.outcome === "ok" && (a += 1));
  return {
    spawned: t.length,
    finished: n,
    ok: a,
    okRate: n > 0 ? a / n : null,
    cost: r,
    agentTypes: c.size,
    running: o
  };
}
function ie(t) {
  const o = /* @__PURE__ */ new Map();
  for (const n of t) {
    let r = o.get(n.agent);
    r || (r = {
      s: {
        agent: n.agent,
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
    }, o.set(n.agent, r));
    const c = r.s;
    switch (c.spawned += 1, c.cost += n.cost, c.tokens += n.tokens, c.tools += n.tools, n.start > c.lastUsed && (c.lastUsed = n.start), n.outcome) {
      case "ok":
        c.ok += 1;
        break;
      case "error":
        c.error += 1;
        break;
      case "aborted":
        c.aborted += 1;
        break;
      case "running":
        c.running += 1;
        break;
    }
    n.duration_ms > 0 && r.durations.push(n.duration_ms), n.model && r.models.set(n.model, (r.models.get(n.model) ?? 0) + 1);
  }
  const a = [];
  for (const { s: n, durations: r, models: c } of o.values()) {
    const d = n.spawned - n.running;
    n.okRate = d > 0 ? n.ok / d : null, n.medianDurationMs = Ae(r), n.models = [...c.entries()].map(([i, u]) => ({ model: i, count: u })).sort((i, u) => u.count - i.count), a.push(n);
  }
  return a.sort((n, r) => r.spawned - n.spawned || n.agent.localeCompare(r.agent));
}
function Ie(t, o, a) {
  const n = ie(t).map((p) => p.agent), r = new Map(n.map((p, m) => [p, m])), c = re[o];
  let d;
  if (c != null) d = a - c;
  else {
    d = a;
    for (const p of t) p.start < d && (d = p.start);
  }
  const i = Te(o, a - d), u = (p) => {
    if (i < b) return Math.floor(p / i) * i;
    const m = new Date(p);
    return m.setHours(0, 0, 0, 0), i > b && m.setDate(m.getDate() - (m.getDay() + 6) % 7), m.getTime();
  }, v = u(d), y = [], l = /* @__PURE__ */ new Map();
  for (let p = v; p <= a; p = i < b ? p + i : Oe(p, i)) {
    const m = { t: p, counts: new Array(n.length).fill(0), total: 0 };
    y.push(m), l.set(p, m);
  }
  let x = 0;
  for (const p of t) {
    const m = l.get(u(p.start));
    if (!m) continue;
    const h = r.get(p.agent);
    h !== void 0 && (m.counts[h] += 1, m.total += 1, m.total > x && (x = m.total));
  }
  return { agents: n, buckets: y, bucketMs: i, max: x };
}
function Oe(t, o) {
  const a = new Date(t);
  return a.setDate(a.getDate() + Math.round(o / b)), a.setHours(0, 0, 0, 0), a.getTime();
}
const _e = [
  "var(--ctx-src-skill)",
  "var(--ctx-src-memory)",
  "var(--ctx-src-history)",
  "var(--ctx-src-lessons)",
  "var(--ctx-src-sys)",
  "var(--ctx-src-skillidx)",
  "var(--ctx-src-tool)"
], Le = "var(--ctx-src-mute, var(--muted))";
function A(t) {
  return _e[t] ?? Le;
}
const We = {
  "1h": "1h",
  "3h": "3h",
  "6h": "6h",
  "12h": "12h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "All"
}, Y = {
  running: "Running",
  ok: "OK",
  error: "Error",
  aborted: "Aborted",
  unfinished: "Unfinished",
  "no data": "No data"
}, le = {
  running: "aim",
  ok: "ok",
  error: "err",
  aborted: "err",
  unfinished: "warn",
  "no data": "muted"
};
function de(t) {
  return Y[t] ?? Y["no data"];
}
function z(t) {
  const o = t === 0 ? 2 : t < 0.1 ? 4 : 2;
  return new Intl.NumberFormat(P(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: t === 0 || t >= 0.1 ? void 0 : o,
    maximumFractionDigits: o
  }).format(t);
}
function K(t) {
  return new Intl.NumberFormat(P(), { style: "percent", maximumFractionDigits: 0 }).format(t);
}
function ce(t) {
  return new Intl.NumberFormat(P(), { notation: "compact", maximumFractionDigits: 1 }).format(t);
}
function _(t) {
  if (t == null || t <= 0) return "—";
  const o = Math.round(t / 1e3), a = Math.floor(o / 3600), n = Math.floor(o % 3600 / 60), r = o % 60;
  return a > 0 ? `${a}h ${n}m` : n > 0 ? `${n}m ${r}s` : `${r}s`;
}
const me = 864e5, F = 44, W = 14, $ = 2 * Math.PI * F, N = 140;
function $e({ stats: t, total: o }) {
  const [a, n] = D(null);
  let r = 0;
  const c = t.map((d, i) => {
    const u = o > 0 ? d.spawned / o : 0, v = { i, s: d, frac: u, offset: r };
    return r += u, v;
  });
  return /* @__PURE__ */ s("div", { className: "oa-donut", "data-testid": "agents-donut", children: [
    /* @__PURE__ */ s("div", { className: "oa-donut-ring", children: [
      /* @__PURE__ */ s("svg", { viewBox: "0 0 120 120", "aria-hidden": "true", children: [
        /* @__PURE__ */ e("circle", { cx: "60", cy: "60", r: F, fill: "none", strokeWidth: W, style: { stroke: "var(--bg-hover)" } }),
        c.map(({ i: d, frac: i, offset: u }) => i > 0 && /* @__PURE__ */ e(
          "circle",
          {
            cx: "60",
            cy: "60",
            r: F,
            fill: "none",
            strokeWidth: a === d ? W + 4 : W,
            strokeDasharray: `${i * $} ${$}`,
            strokeDashoffset: -u * $,
            style: { stroke: A(d), transition: "stroke-width .15s" },
            onMouseEnter: () => n(d),
            onMouseLeave: () => n(null)
          },
          d
        ))
      ] }),
      /* @__PURE__ */ s("div", { className: "oa-donut-center", children: [
        /* @__PURE__ */ e("span", { className: "oa-donut-total", children: f(a == null ? o : c[a].s.spawned) }),
        /* @__PURE__ */ e("span", { className: "oa-donut-label", children: a == null ? "Spawned" : c[a].s.agent })
      ] })
    ] }),
    /* @__PURE__ */ e("ul", { className: "oa-legend", "aria-label": "Spawned by agent type", children: c.map(({ i: d, s: i, frac: u }) => /* @__PURE__ */ s(
      "li",
      {
        "data-hover": a === d,
        onMouseEnter: () => n(d),
        onMouseLeave: () => n(null),
        children: [
          /* @__PURE__ */ e("span", { className: "oa-swatch", style: { background: A(d) } }),
          /* @__PURE__ */ e("span", { className: "oa-legend-name oa-mono", children: i.agent }),
          /* @__PURE__ */ s("span", { className: "oa-legend-n", children: [
            f(i.spawned),
            " · ",
            K(u)
          ] })
        ]
      },
      i.agent
    )) })
  ] });
}
function Q(t, o) {
  return o < me ? O(t) : te(t);
}
function Ue({ timeline: t }) {
  const { buckets: o, agents: a, max: n, bucketMs: r } = t, [c, d] = D(null), i = ge(), u = o.length, v = u > 0 ? 100 / u : 100, y = n > 0 ? (N - 4) / n : 0, l = v * 0.12, x = Math.max(1, Math.ceil(u / 6)), p = c != null ? o[c] : null;
  return /* @__PURE__ */ s("div", { style: { minWidth: 0 }, "data-testid": "agents-timeline", children: [
    /* @__PURE__ */ s("div", { className: "oa-tl", children: [
      /* @__PURE__ */ s("div", { className: "oa-tl-axis", style: { height: N }, children: [
        /* @__PURE__ */ e("span", { style: { top: 0 }, children: f(n) }),
        /* @__PURE__ */ e("span", { style: { bottom: 0 }, children: f(0) })
      ] }),
      /* @__PURE__ */ s("div", { className: "oa-tl-plot", style: { height: N }, onMouseLeave: () => d(null), children: [
        /* @__PURE__ */ s("svg", { viewBox: `0 0 100 ${N}`, preserveAspectRatio: "none", "aria-labelledby": `${i}-title`, children: [
          /* @__PURE__ */ e("title", { id: `${i}-title`, children: "Spawns over time" }),
          /* @__PURE__ */ e("line", { x1: "0", x2: "100", y1: N - 0.5, y2: N - 0.5, style: { stroke: "var(--border)" }, strokeWidth: "1", vectorEffect: "non-scaling-stroke" }),
          o.map((m, h) => {
            let g = N;
            return /* @__PURE__ */ s(
              "g",
              {
                onMouseEnter: () => d(h),
                style: { opacity: c != null && c !== h ? 0.6 : 1, transition: "opacity .12s" },
                children: [
                  /* @__PURE__ */ s("title", { children: [
                    Q(m.t, r),
                    ": ",
                    f(m.total)
                  ] }),
                  /* @__PURE__ */ e("rect", { x: h * v, y: "0", width: v, height: N, fill: "transparent" }),
                  m.counts.map((w, T) => {
                    if (w === 0) return null;
                    const k = w * y;
                    return g -= k, /* @__PURE__ */ e("rect", { x: h * v + l, y: g, width: v - 2 * l, height: k, style: { fill: A(T) } }, T);
                  })
                ]
              },
              m.t
            );
          })
        ] }),
        p && /* @__PURE__ */ s(
          "div",
          {
            className: "oa-tip",
            style: c != null && c > u / 2 ? { right: 4 } : { left: 4 },
            "data-testid": "agents-timeline-tooltip",
            children: [
              /* @__PURE__ */ e("div", { style: { fontWeight: 500 }, children: Q(p.t, r) }),
              /* @__PURE__ */ s("div", { className: "oa-muted", children: [
                f(p.total),
                " spawned"
              ] }),
              p.counts.map((m, h) => m > 0 && /* @__PURE__ */ s("div", { className: "oa-tip-row", children: [
                /* @__PURE__ */ e("span", { className: "oa-swatch", style: { background: A(h), width: 8, height: 8 } }),
                /* @__PURE__ */ e("span", { className: "oa-mono", children: a[h] }),
                /* @__PURE__ */ e("b", { children: f(m) })
              ] }, h))
            ]
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ e("div", { className: "oa-tl-ticks", "aria-hidden": "true", children: o.map((m, h) => h % x === 0 && /* @__PURE__ */ e("span", { style: { left: `${h * v}%` }, children: r < me ? B(m.t) : te(m.t) }, m.t)) })
  ] });
}
function pe({ run: t, onOpen: o }) {
  return /* @__PURE__ */ e(
    "button",
    {
      type: "button",
      className: "oa-name",
      onClick: (a) => {
        a.stopPropagation(), o(t);
      },
      "aria-label": `Open run ${t.name}`,
      title: t.key,
      children: t.name
    }
  );
}
function Be({ run: t }) {
  return /* @__PURE__ */ s(I, { variant: le[t.outcome] ?? "muted", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, children: [
    t.outcome === "running" && /* @__PURE__ */ e(C, { size: 11, className: "oa-pulse", "aria-hidden": "true" }),
    de(t.outcome)
  ] });
}
function Fe({ stats: t, now: o }) {
  return /* @__PURE__ */ s("table", { className: "oa-table", "data-testid": "agents-type-table", children: [
    /* @__PURE__ */ e("thead", { children: /* @__PURE__ */ s("tr", { children: [
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
    /* @__PURE__ */ e("tbody", { children: t.map((a, n) => /* @__PURE__ */ s("tr", { "data-testid": `agents-type-row-${a.agent}`, children: [
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ s("span", { className: "oa-inline", children: [
        /* @__PURE__ */ e("span", { className: "oa-swatch", style: { background: A(n) }, "aria-hidden": "true" }),
        /* @__PURE__ */ e("span", { className: "oa-mono", style: { color: "var(--text-strong)" }, children: a.agent }),
        a.running > 0 && /* @__PURE__ */ s(I, { variant: "aim", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, children: [
          f(a.running),
          " running"
        ] })
      ] }) }),
      /* @__PURE__ */ e("td", { className: "num", children: f(a.spawned) }),
      /* @__PURE__ */ e("td", { className: "num", children: a.okRate == null ? "—" : K(a.okRate) }),
      /* @__PURE__ */ e("td", { className: "num", style: { color: a.error > 0 ? "var(--danger)" : "var(--muted)" }, children: f(a.error) }),
      /* @__PURE__ */ e("td", { className: "num", style: { color: a.aborted > 0 ? "var(--danger)" : "var(--muted)" }, children: f(a.aborted) }),
      /* @__PURE__ */ s("td", { className: "num", children: [
        /* @__PURE__ */ e("span", { children: z(a.cost) }),
        /* @__PURE__ */ s("span", { className: "oa-muted", style: { display: "block", fontSize: 11 }, children: [
          z(a.spawned > 0 ? a.cost / a.spawned : 0),
          " / run"
        ] })
      ] }),
      /* @__PURE__ */ e("td", { className: "num", children: ce(a.tokens) }),
      /* @__PURE__ */ e("td", { className: "num", children: _(a.medianDurationMs) }),
      /* @__PURE__ */ e("td", { className: "num", children: f(a.spawned > 0 ? a.tools / a.spawned : 0, { maximumFractionDigits: 1 }) }),
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ e("span", { className: "oa-models", children: a.models.slice(0, 3).map((r) => /* @__PURE__ */ e(I, { variant: "muted", className: "oa-mono", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, title: f(r.count), children: r.model }, r.model)) }) }),
      /* @__PURE__ */ e("td", { className: "oa-muted", title: O(a.lastUsed), children: ke(a.lastUsed, { now: o }) })
    ] }, a.agent)) })
  ] });
}
function Pe({ runs: t, now: o, selectedKey: a, onOpen: n }) {
  return /* @__PURE__ */ s("table", { className: "oa-table", "data-testid": "agents-running-table", children: [
    /* @__PURE__ */ e("thead", { children: /* @__PURE__ */ s("tr", { children: [
      /* @__PURE__ */ e("th", { children: "Name" }),
      /* @__PURE__ */ e("th", { children: "Agent" }),
      /* @__PURE__ */ e("th", { children: "Project" }),
      /* @__PURE__ */ e("th", { children: "Model" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Elapsed" }),
      /* @__PURE__ */ e("th", { className: "num", children: "Cost" })
    ] }) }),
    /* @__PURE__ */ e("tbody", { children: t.map((r) => /* @__PURE__ */ s("tr", { className: "oa-click", "data-selected": r.key === a, onClick: () => n(r), "data-testid": "agents-running-row", children: [
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ s("span", { className: "oa-inline", children: [
        /* @__PURE__ */ e(C, { size: 13, className: "oa-pulse", style: { color: "var(--aim)", flex: "none" }, "aria-hidden": "true" }),
        /* @__PURE__ */ e(pe, { run: r, onOpen: n })
      ] }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono", children: r.kind === "main" ? "main session" : r.agent }),
      /* @__PURE__ */ e("td", { className: "oa-muted", children: /* @__PURE__ */ e("span", { className: "oa-trunc", title: r.project, children: r.project }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono oa-muted", children: r.model }),
      /* @__PURE__ */ e("td", { className: "num", children: _(o - r.start) }),
      /* @__PURE__ */ e("td", { className: "num", children: z(r.cost) })
    ] }, r.key)) })
  ] });
}
function Ke({ runs: t, selectedKey: o, onOpen: a }) {
  return /* @__PURE__ */ s("table", { className: "oa-table", "data-testid": "agents-recent-table", children: [
    /* @__PURE__ */ e("thead", { children: /* @__PURE__ */ s("tr", { children: [
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
    /* @__PURE__ */ e("tbody", { children: t.map((n) => /* @__PURE__ */ s("tr", { className: "oa-click", "data-selected": n.key === o, onClick: () => a(n), "data-testid": "agents-recent-row", children: [
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ e(pe, { run: n, onOpen: a }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono", children: n.agent }),
      /* @__PURE__ */ e("td", { children: /* @__PURE__ */ e(Be, { run: n }) }),
      /* @__PURE__ */ e("td", { className: "oa-muted", children: /* @__PURE__ */ e("span", { className: "oa-trunc", title: n.project, children: n.project }) }),
      /* @__PURE__ */ e("td", { className: "oa-mono oa-muted", children: n.model }),
      /* @__PURE__ */ e("td", { className: "oa-muted", children: O(n.start) }),
      /* @__PURE__ */ e("td", { className: "num", children: _(n.duration_ms) }),
      /* @__PURE__ */ e("td", { className: "num", children: ce(n.tokens) }),
      /* @__PURE__ */ e("td", { className: "num", children: f(n.tools) }),
      /* @__PURE__ */ e("td", { className: "num", children: z(n.cost) })
    ] }, n.key)) })
  ] });
}
const U = 200, je = 3e3;
function He({ m: t }) {
  if (t.role === "tool")
    return /* @__PURE__ */ s("div", { className: "oa-msg", "data-testid": "agents-msg-tool", children: [
      /* @__PURE__ */ e(be, { size: 13, className: "oa-msg-icon oa-muted", "aria-label": "Tool result" }),
      /* @__PURE__ */ s("div", { className: "oa-msg-body", children: [
        /* @__PURE__ */ s("div", { className: "oa-msg-meta", children: [
          t.tool_name && /* @__PURE__ */ e("span", { className: "oa-mono", style: { color: "var(--text)" }, children: t.tool_name }),
          " · ",
          B(t.ts)
        ] }),
        /* @__PURE__ */ e("pre", { className: "oa-tool-out", children: t.text })
      ] })
    ] });
  const o = t.role === "assistant";
  return /* @__PURE__ */ s("div", { className: "oa-msg", "data-testid": o ? "agents-msg-assistant" : "agents-msg-user", children: [
    o ? /* @__PURE__ */ e(E, { size: 13, className: "oa-msg-icon", style: { color: "var(--accent)" }, "aria-label": "Assistant" }) : /* @__PURE__ */ e(ye, { size: 13, className: "oa-msg-icon oa-muted", "aria-label": "User" }),
    /* @__PURE__ */ s("div", { className: "oa-msg-body", children: [
      /* @__PURE__ */ e("div", { className: "oa-msg-meta", children: B(t.ts) }),
      o ? /* @__PURE__ */ e("div", { className: "oa-msg-text", children: t.text.split(`
`).map((a, n) => a.startsWith("→ ") ? /* @__PURE__ */ s("div", { className: "oa-call", children: [
        /* @__PURE__ */ e(Ne, { size: 11, style: { verticalAlign: "-1px" }, "aria-hidden": "true" }),
        " ",
        a.slice(2)
      ] }, n) : /* @__PURE__ */ e("div", { children: a }, n)) }) : /* @__PURE__ */ e("div", { className: "oa-msg-text oa-msg-user", children: t.text })
    ] })
  ] });
}
function qe({ run: t, now: o, mobile: a, onClose: n, onOpenParent: r }) {
  const c = ae(), d = t.outcome === "running", { data: i, error: u, isLoading: v, refetch: y } = ee({
    queryKey: ["omp-agents", "session", t.key, U],
    queryFn: () => c.get(`${oe}/session?key=${encodeURIComponent(t.key)}&tail=${U}`),
    refetchInterval: d ? je : !1,
    placeholderData: xe
  }), l = H(null), x = H(!0), p = (i == null ? void 0 : i.messages.length) ?? 0;
  Z(() => {
    const h = l.current;
    h && x.current && (h.scrollTop = h.scrollHeight);
  }, [p, t.key]);
  const m = (i == null ? void 0 : i.outcome) ?? t.outcome;
  return /* @__PURE__ */ s("aside", { className: `oa-drawer${a ? " oa-drawer-mobile" : ""}`, "data-testid": "agents-drawer", children: [
    /* @__PURE__ */ s("div", { className: "oa-drawer-head", children: [
      /* @__PURE__ */ e(E, { size: 16, style: { color: "var(--accent)", flex: "none" } }),
      /* @__PURE__ */ e("div", { className: "oa-drawer-title", title: t.name, children: t.name }),
      t.parent_key && /* @__PURE__ */ s("button", { type: "button", className: "oa-btn", onClick: () => r(t.parent_key), "data-testid": "agents-drawer-parent", children: [
        /* @__PURE__ */ e(ve, { size: 13 }),
        " Parent"
      ] }),
      /* @__PURE__ */ e("button", { type: "button", className: "oa-btn", onClick: n, "aria-label": "Close", "data-testid": "agents-drawer-close", children: /* @__PURE__ */ e(we, { size: 13 }) })
    ] }),
    /* @__PURE__ */ s("div", { className: "oa-drawer-meta", "data-testid": "agents-drawer-meta", children: [
      /* @__PURE__ */ s(I, { variant: le[m] ?? "muted", style: { fontSize: 11, paddingTop: 0, paddingBottom: 0 }, children: [
        m === "running" && /* @__PURE__ */ e(C, { size: 11, className: "oa-pulse", "aria-hidden": "true" }),
        de(m)
      ] }),
      /* @__PURE__ */ e("span", { className: "oa-mono", style: { color: "var(--text)" }, children: t.kind === "main" ? "main session" : t.agent }),
      /* @__PURE__ */ e("span", { className: "oa-mono", children: t.model }),
      /* @__PURE__ */ e("span", { style: { overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }, title: t.project, children: t.project }),
      /* @__PURE__ */ e("span", { title: O(t.start), children: _(d ? o - t.start : t.duration_ms) }),
      /* @__PURE__ */ e("span", { children: z(t.cost) })
    ] }),
    /* @__PURE__ */ s(
      "div",
      {
        ref: l,
        className: "oa-transcript",
        "aria-live": d ? "polite" : void 0,
        "data-testid": "agents-drawer-transcript",
        onScroll: (h) => {
          const g = h.currentTarget;
          x.current = g.scrollHeight - g.scrollTop - g.clientHeight < 24;
        },
        children: [
          u && /* @__PURE__ */ s("div", { className: "oa-error", "data-testid": "agents-drawer-error", children: [
            "Could not load this session: ",
            u instanceof Error ? u.message : String(u)
          ] }),
          v && !i && /* @__PURE__ */ e(ne, { rows: 4 }),
          i && i.messages.length === 0 && !u && /* @__PURE__ */ e("div", { className: "oa-empty", children: "No messages in this session yet." }),
          i && i.messages.length >= U && /* @__PURE__ */ s("div", { className: "oa-muted", style: { fontSize: 11, textAlign: "center" }, children: [
            "Showing the last ",
            i.messages.length,
            " messages"
          ] }),
          i == null ? void 0 : i.messages.map((h, g) => /* @__PURE__ */ e(He, { m: h }, `${h.ts}-${g}`)),
          d && i && /* @__PURE__ */ s("div", { className: "oa-live", children: [
            /* @__PURE__ */ e(C, { size: 11, className: "oa-pulse", style: { color: "var(--aim)" }, "aria-hidden": "true" }),
            "Live · refreshing every 3 s",
            /* @__PURE__ */ e("button", { type: "button", className: "oa-btn", onClick: () => void y(), children: "Refresh" })
          ] }),
          !d && i && /* @__PURE__ */ s("div", { className: "oa-msg-meta", children: [
            f(i.messages.length),
            " messages"
          ] })
        ]
      }
    )
  ] });
}
const X = `
.oa-root { display: flex; height: 100%; min-height: 0; min-width: 0; overflow: hidden; color: var(--text); font-family: var(--font-body, inherit); }
.oa-main { flex: 1; min-width: 0; overflow-y: auto; }
.oa-body { padding: 0 24px 24px; }
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
`, ue = "omp-agents-window", Ge = 15e3, Ye = 100, J = "(max-width: 767px)";
function Qe() {
  try {
    const t = localStorage.getItem(ue);
    return se.includes(t ?? "") ? t : G;
  } catch {
    return G;
  }
}
function Xe() {
  const [t, o] = D(() => window.matchMedia(J).matches);
  return Z(() => {
    const a = window.matchMedia(J), n = () => o(a.matches);
    return a.addEventListener("change", n), () => a.removeEventListener("change", n);
  }, []), t;
}
function V({ label: t, count: o }) {
  return /* @__PURE__ */ s("div", { className: "oa-section", children: [
    t,
    /* @__PURE__ */ e("span", { className: "oa-count", children: f(o) })
  ] });
}
function nt() {
  const t = ae(), o = Xe(), [a, n] = D(Qe), [r, c] = D(null), { data: d, error: i, isLoading: u, refetch: v } = ee({
    queryKey: ["omp-agents", "runs"],
    queryFn: () => t.get(`${oe}/runs`),
    refetchInterval: Ge
  }), y = (g) => {
    n(g);
    try {
      localStorage.setItem(ue, g);
    } catch {
      return;
    }
  }, l = fe(() => {
    if (!d) return null;
    const g = d.now, w = De(Re(d.runs, a, g)), T = Ce(d.runs);
    return {
      now: g,
      spawned: w,
      running: T,
      stats: ie(w),
      kpis: Ee(w, T.length),
      timeline: Ie(w, a, g),
      recent: [...w].sort((k, he) => he.start - k.start).slice(0, Ye),
      byKey: new Map(d.runs.map((k) => [k.key, k]))
    };
  }, [d, a]), x = r && l ? l.byKey.get(r.key) ?? r : r, p = (g) => {
    const w = l == null ? void 0 : l.byKey.get(g);
    w && c(w);
  }, m = x && /* @__PURE__ */ e(qe, { run: x, now: (l == null ? void 0 : l.now) ?? Date.now(), mobile: o, onClose: () => c(null), onOpenParent: p }), h = i ? i instanceof Error ? i.message : String(i) : null;
  return o && m ? /* @__PURE__ */ s("div", { className: "oa-root", "data-testid": "agents-page", children: [
    /* @__PURE__ */ e("style", { children: X }),
    m
  ] }) : /* @__PURE__ */ s("div", { className: "oa-root", "data-testid": "agents-page", children: [
    /* @__PURE__ */ e("style", { children: X }),
    /* @__PURE__ */ s("div", { className: "oa-main", children: [
      /* @__PURE__ */ e("div", { style: { paddingTop: 12 }, children: /* @__PURE__ */ e(
        Se,
        {
          title: "Agents",
          subtitle: "omp subagents spawned across all sessions, plus what is running now",
          actions: /* @__PURE__ */ e(
            Me,
            {
              segments: se.map((g) => ({ key: g, label: We[g] })),
              value: a,
              onChange: y,
              layoutId: "omp-agents-window",
              ariaLabel: "Time window",
              collapse: !1
            }
          )
        }
      ) }),
      /* @__PURE__ */ s("div", { className: "oa-body", children: [
        h && /* @__PURE__ */ s("div", { className: "oa-error", "data-testid": "agents-load-error", children: [
          "Could not load agent runs: ",
          h
        ] }),
        u && !l && /* @__PURE__ */ e(ne, { rows: 6 }),
        l && /* @__PURE__ */ s(j, { children: [
          /* @__PURE__ */ s("div", { className: "oa-kpis", "data-testid": "agents-kpis", children: [
            /* @__PURE__ */ e(R, { label: "Spawned", value: f(l.kpis.spawned), "data-testid": "stat-card-spawned" }),
            /* @__PURE__ */ e(
              R,
              {
                label: "OK rate",
                value: l.kpis.okRate == null ? "—" : K(l.kpis.okRate),
                colorClass: l.kpis.okRate == null ? "" : l.kpis.okRate >= 0.9 ? "text-ok-text" : l.kpis.okRate >= 0.6 ? "text-warn-text" : "text-danger-text",
                title: "Finished runs that ended OK, over finished runs. Running runs are excluded.",
                delay: 40,
                "data-testid": "stat-card-ok-rate"
              }
            ),
            /* @__PURE__ */ e(R, { label: "Spend", value: z(l.kpis.cost), delay: 80, "data-testid": "stat-card-spend" }),
            /* @__PURE__ */ e(R, { label: "Agent types", value: f(l.kpis.agentTypes), delay: 120, "data-testid": "stat-card-types" }),
            /* @__PURE__ */ e(R, { label: "Running now", value: f(l.kpis.running), accent: l.kpis.running > 0, delay: 160, "data-testid": "stat-card-running" })
          ] }),
          l.spawned.length === 0 && l.running.length === 0 ? /* @__PURE__ */ e(S, { children: /* @__PURE__ */ e(q, { icon: /* @__PURE__ */ e(E, {}), title: "No agent runs yet", subtitle: "Subagents spawned by omp in this window will show up here.", testId: "agents-empty" }) }) : /* @__PURE__ */ s(j, { children: [
            /* @__PURE__ */ s("div", { className: "oa-grid2", children: [
              /* @__PURE__ */ s(S, { children: [
                /* @__PURE__ */ e(L, { children: "Spawned by type" }),
                l.spawned.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "No runs in this window." }) : /* @__PURE__ */ e($e, { stats: l.stats, total: l.kpis.spawned })
              ] }),
              /* @__PURE__ */ s(S, { children: [
                /* @__PURE__ */ e(L, { children: "Spawns over time" }),
                /* @__PURE__ */ e(Ue, { timeline: l.timeline })
              ] })
            ] }),
            /* @__PURE__ */ s(S, { className: "oa-card-flush", children: [
              /* @__PURE__ */ e("div", { className: "oa-card-title-pad", children: /* @__PURE__ */ e(L, { children: "By agent type" }) }),
              l.stats.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "No runs in this window." }) : /* @__PURE__ */ e(Fe, { stats: l.stats, now: l.now })
            ] }),
            /* @__PURE__ */ e(V, { label: "Running now", count: l.running.length }),
            /* @__PURE__ */ e(S, { className: "oa-card-flush", children: l.running.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", "data-testid": "agents-running-empty", children: "Nothing is running right now." }) : /* @__PURE__ */ e(Pe, { runs: l.running, now: l.now, selectedKey: (x == null ? void 0 : x.key) ?? null, onOpen: c }) }),
            /* @__PURE__ */ e(V, { label: "Recent runs", count: l.recent.length }),
            /* @__PURE__ */ e(S, { className: "oa-card-flush", children: l.recent.length === 0 ? /* @__PURE__ */ e("div", { className: "oa-empty", children: "No runs in this window." }) : /* @__PURE__ */ e(Ke, { runs: l.recent, selectedKey: (x == null ? void 0 : x.key) ?? null, onOpen: c }) })
          ] })
        ] }),
        i && !l && /* @__PURE__ */ e(
          q,
          {
            icon: /* @__PURE__ */ e(E, {}),
            title: "Could not load agent runs",
            action: /* @__PURE__ */ e(ze, { onClick: () => void v(), children: "Refresh" }),
            testId: "agents-error-empty"
          }
        )
      ] })
    ] }),
    m
  ] });
}
export {
  nt as default
};
