import { jsxs as s, jsx as r, Fragment as T } from "react/jsx-runtime";
import { PageHeader as C } from "@kirocrew/app-sdk/ui";
import { Loader2 as O, RefreshCw as D } from "lucide-react";
import { useAppApi as U, useAppInfo as F } from "@kirocrew/app-sdk";
import { useRef as w, useState as M, useEffect as z, useCallback as I } from "react";
const W = 0.75, j = 0.9, G = 6e4;
function H(e) {
  var n;
  if (e.status === "exhausted") return 1;
  const t = (n = e.amount) == null ? void 0 : n.usedFraction;
  return typeof t == "number" && Number.isFinite(t) ? Math.max(0, t) : null;
}
function Y(e) {
  return e == null ? "ok" : e >= j ? "danger" : e >= W ? "warn" : "ok";
}
function B(e) {
  const t = e.metadata;
  return t != null && t.email ? t.email : t != null && t.orgName ? t.orgName : t != null && t.accountId ? t.accountId.slice(0, 8) : null;
}
function V(e) {
  const t = /* @__PURE__ */ new Map();
  for (const n of e ?? []) {
    let i = t.get(n.provider);
    i || (i = { provider: n.provider, accounts: [] }, t.set(n.provider, i)), i.accounts.push(n);
  }
  return [...t.values()];
}
const S = 6e4, x = 60 * S, b = 24 * x;
function K(e) {
  return `${Math.round(e * 100)}%`;
}
function P(e) {
  return e.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
function $(e) {
  return e >= b ? E([[Math.floor(e / b), "d"], [Math.floor(e % b / x), "h"]]) : e >= x ? E([[Math.floor(e / x), "h"], [Math.floor(e % x / S), "m"]]) : `${Math.max(1, Math.floor(e / S))}m`;
}
function E(e) {
  return e.filter(([t]) => t > 0).map(([t, n]) => `${t}${n}`).join(" ");
}
function L(e, t) {
  const n = Math.max(0, t - e);
  return n < S ? "just now" : n < x ? `${Math.floor(n / S)}m ago` : n < b ? `${Math.floor(n / x)}h ago` : `${Math.floor(n / b)}d ago`;
}
const q = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, J = {
  ok: "var(--text)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, g = { color: "var(--muted)" }, k = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, N = { animation: "omp-usage-spin 1s linear infinite" }, Q = "@keyframes omp-usage-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[data-omp-usage-spin]{animation:none!important}}";
function X({ limit: e, now: t, compact: n }) {
  var p;
  const i = H(e), l = Y(i), o = i == null ? 0 : Math.min(100, Math.round(i * 100)), a = e.amount, d = (a == null ? void 0 : a.used) != null && a.limit != null && a.unit !== "percent", u = (p = e.window) == null ? void 0 : p.resetsAt, f = u != null && u > t, m = u == null ? "" : f ? `↻ ${$(u - t)}` : "Resets momentarily", h = d ? `${P(a.used)} / ${P(a.limit)} ${a.unit ?? ""}`.trim() : "", c = n ? "minmax(0,1fr) 48px 38px 64px" : "minmax(0,1fr) 120px 48px 76px";
  return /* @__PURE__ */ s(
    "li",
    {
      "data-testid": "omp-usage-limit",
      title: f ? `Resets in ${$(u - t)}` : void 0,
      style: { display: "grid", gridTemplateColumns: c, alignItems: "center", columnGap: 12, padding: "4px 0" },
      children: [
        /* @__PURE__ */ s("span", { style: { minWidth: 0, display: "flex", flexDirection: "column" }, children: [
          /* @__PURE__ */ r("span", { style: { ...k, fontSize: 13, color: "var(--text)" }, children: e.label }),
          h && /* @__PURE__ */ r("span", { style: { ...g, ...k, fontSize: 11, fontVariantNumeric: "tabular-nums" }, children: h })
        ] }),
        /* @__PURE__ */ r(
          "span",
          {
            role: "progressbar",
            "aria-label": e.label,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": o,
            "data-severity": l,
            style: { height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden" },
            children: /* @__PURE__ */ r("span", { style: { display: "block", height: "100%", width: `${o}%`, background: q[l], borderRadius: 4 } })
          }
        ),
        /* @__PURE__ */ r("span", { style: { fontSize: 13, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", color: J[l] }, children: i == null ? "—" : K(i) }),
        /* @__PURE__ */ r("span", { style: { ...g, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, children: m })
      ]
    }
  );
}
function Z({ report: e, now: t, compact: n }) {
  var a;
  const i = B(e), l = (a = e.metadata) == null ? void 0 : a.planType, o = e.limits ?? [];
  return /* @__PURE__ */ s(
    "div",
    {
      "data-testid": "omp-usage-account",
      style: { display: "flex", flexDirection: "column", gap: 6, borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "10px 12px" },
      children: [
        /* @__PURE__ */ s("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [
          i && /* @__PURE__ */ r("span", { title: i, style: { ...k, fontSize: 13, fontWeight: 600, color: "var(--text)" }, children: i }),
          l && /* @__PURE__ */ r("span", { style: { ...g, flexShrink: 0, fontSize: 10.5, padding: "0 6px", borderRadius: 4, border: "1px solid var(--border)" }, children: l }),
          e.fetchedAt != null && /* @__PURE__ */ r("span", { style: { ...g, marginLeft: "auto", flexShrink: 0, fontSize: 11 }, children: L(e.fetchedAt, t) })
        ] }),
        o.length === 0 ? /* @__PURE__ */ r("p", { style: { ...g, margin: 0, fontSize: 12 }, children: "No usage data" }) : /* @__PURE__ */ r("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }, children: o.map((d) => /* @__PURE__ */ r(X, { limit: d, now: t, compact: n }, d.id)) })
      ]
    }
  );
}
function ee({ data: e, error: t, loading: n, refreshing: i, onRefresh: l, compact: o = !1, now: a = Date.now() }) {
  const d = V(e == null ? void 0 : e.reports), u = t ?? (e && !e.ok ? e.error ?? "OMP usage is unavailable." : null);
  return /* @__PURE__ */ s("div", { "data-testid": "omp-usage-panel", style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ r("style", { children: Q }),
    /* @__PURE__ */ s("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: o ? "10px 12px" : "0 0 12px", borderBottom: o ? "1px solid var(--border)" : void 0 }, children: [
      o && /* @__PURE__ */ r("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--text)" }, children: "OMP usage" }),
      e != null && e.fetchedAt ? /* @__PURE__ */ s("span", { style: { ...g, fontSize: 11.5 }, children: [
        "Fetched ",
        L(e.fetchedAt, a)
      ] }) : null,
      /* @__PURE__ */ r(
        "button",
        {
          type: "button",
          "aria-label": "Refresh usage",
          title: "Refresh usage",
          onClick: l,
          disabled: i,
          style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: i ? "default" : "pointer" },
          children: i ? /* @__PURE__ */ r(O, { size: 13, style: N, "data-omp-usage-spin": "" }) : /* @__PURE__ */ r(D, { size: 13 })
        }
      )
    ] }),
    /* @__PURE__ */ s("div", { style: { display: "flex", flexDirection: "column", gap: 16, padding: o ? 12 : "12px 0", maxHeight: o ? "min(70vh, 520px)" : void 0, overflowY: o ? "auto" : void 0 }, children: [
      u && /* @__PURE__ */ s("div", { role: "alert", style: { borderRadius: 8, padding: "10px 12px", background: "var(--danger-subtle)", border: "1px solid var(--danger)", color: "var(--text)", fontSize: 12.5 }, children: [
        /* @__PURE__ */ r("strong", { style: { display: "block", marginBottom: 2 }, children: "Couldn't load OMP usage" }),
        u
      ] }),
      n && !e && /* @__PURE__ */ s("div", { role: "status", style: { ...g, display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }, children: [
        /* @__PURE__ */ r(O, { size: 13, style: N, "data-omp-usage-spin": "", "aria-hidden": "true" }),
        "Loading usage…"
      ] }),
      e && d.length === 0 && !u && /* @__PURE__ */ r("p", { style: { ...g, margin: 0, fontSize: 11.5 }, children: "No accounts reported usage." }),
      d.map((f) => /* @__PURE__ */ s("section", { "data-testid": "omp-usage-provider", style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
        /* @__PURE__ */ s("h3", { style: { ...g, margin: 0, display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }, children: [
          /* @__PURE__ */ r("span", { children: f.provider }),
          /* @__PURE__ */ s("span", { style: { fontWeight: 400, textTransform: "none", letterSpacing: "normal" }, children: [
            "· ",
            f.accounts.length
          ] })
        ] }),
        f.accounts.map((m, h) => {
          var c, p;
          return /* @__PURE__ */ r(Z, { report: m, now: a, compact: o }, `${((c = m.metadata) == null ? void 0 : c.accountId) ?? ((p = m.metadata) == null ? void 0 : p.email) ?? ""}:${h}`);
        })
      ] }, f.provider))
    ] })
  ] });
}
const _ = "/apps/omp-usage/api/usage";
function te() {
  const e = U(), t = w(e);
  t.current = e;
  const { active: n } = F(), i = n !== !1, [l, o] = M(), [a, d] = M(null), [u, f] = M(!0), [m, h] = M(!1), c = w(!0), p = w(!1);
  z(() => (c.current = !0, () => {
    c.current = !1;
  }), []);
  const v = I(async (A) => {
    try {
      const y = await t.current.get(A ? `${_}?refresh=1` : _);
      if (!c.current) return;
      o(y), d(null);
    } catch (y) {
      c.current && d(y instanceof Error ? y.message : String(y));
    } finally {
      c.current && f(!1);
    }
  }, []), R = I(() => {
    p.current || (p.current = !0, h(!0), v(!0).finally(() => {
      p.current = !1, c.current && h(!1);
    }));
  }, [v]);
  return z(() => {
    if (!i) return;
    v(!1).then(() => R());
    const A = setInterval(() => {
      v(!1);
    }, G);
    return () => clearInterval(A);
  }, [i, v, R]), { data: l, error: a, loading: u, refreshing: m, refresh: R };
}
function se() {
  const { data: e, error: t, loading: n, refreshing: i, refresh: l } = te();
  return /* @__PURE__ */ s(T, { children: [
    /* @__PURE__ */ r(C, { title: "OMP usage", subtitle: "Model-usage limits for every account omp is logged in to" }),
    /* @__PURE__ */ r("div", { style: { padding: "0 24px 32px", overflowY: "auto", flex: 1, minHeight: 0 }, children: /* @__PURE__ */ r("div", { style: { maxWidth: 720 }, children: /* @__PURE__ */ r(ee, { data: e, error: t, loading: n, refreshing: i, onRefresh: l }) }) })
  ] });
}
export {
  se as default
};
