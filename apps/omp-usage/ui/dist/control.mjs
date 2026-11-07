import { jsxs as s, jsx as i } from "react/jsx-runtime";
import { Loader2 as O, RefreshCw as L } from "lucide-react";
import { useAppApi as T, useAppInfo as D } from "@kirocrew/app-sdk";
import { useRef as w, useState as M, useEffect as z, useCallback as I } from "react";
const U = 0.75, F = 0.9, W = 6e4;
function j(e) {
  var n;
  if (e.status === "exhausted") return 1;
  const t = (n = e.amount) == null ? void 0 : n.usedFraction;
  return typeof t == "number" && Number.isFinite(t) ? Math.max(0, t) : null;
}
function G(e) {
  return e == null ? "ok" : e >= F ? "danger" : e >= U ? "warn" : "ok";
}
function B(e) {
  const t = e.metadata;
  return t != null && t.email ? t.email : t != null && t.orgName ? t.orgName : t != null && t.accountId ? t.accountId.slice(0, 8) : null;
}
function V(e) {
  const t = /* @__PURE__ */ new Map();
  for (const n of e ?? []) {
    let r = t.get(n.provider);
    r || (r = { provider: n.provider, accounts: [] }, t.set(n.provider, r)), r.accounts.push(n);
  }
  return [...t.values()];
}
const S = 6e4, x = 60 * S, b = 24 * x;
function Y(e) {
  return `${Math.round(e * 100)}%`;
}
function $(e) {
  return e.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
function E(e) {
  return e >= b ? N([[Math.floor(e / b), "d"], [Math.floor(e % b / x), "h"]]) : e >= x ? N([[Math.floor(e / x), "h"], [Math.floor(e % x / S), "m"]]) : `${Math.max(1, Math.floor(e / S))}m`;
}
function N(e) {
  return e.filter(([t]) => t > 0).map(([t, n]) => `${t}${n}`).join(" ");
}
function C(e, t) {
  const n = Math.max(0, t - e);
  return n < S ? "just now" : n < x ? `${Math.floor(n / S)}m ago` : n < b ? `${Math.floor(n / x)}h ago` : `${Math.floor(n / b)}d ago`;
}
const H = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, K = {
  ok: "var(--text)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, g = { color: "var(--muted)" }, k = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, _ = { animation: "omp-usage-spin 1s linear infinite" }, q = "@keyframes omp-usage-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[data-omp-usage-spin]{animation:none!important}}";
function J({ limit: e, now: t, compact: n }) {
  var p;
  const r = j(e), l = G(r), o = r == null ? 0 : Math.min(100, Math.round(r * 100)), a = e.amount, d = (a == null ? void 0 : a.used) != null && a.limit != null && a.unit !== "percent", u = (p = e.window) == null ? void 0 : p.resetsAt, f = u != null && u > t, m = u == null ? "" : f ? `↻ ${E(u - t)}` : "Resets momentarily", h = d ? `${$(a.used)} / ${$(a.limit)} ${a.unit ?? ""}`.trim() : "", c = n ? "minmax(0,1fr) 48px 38px 64px" : "minmax(0,1fr) 120px 48px 76px";
  return /* @__PURE__ */ s(
    "li",
    {
      "data-testid": "omp-usage-limit",
      title: f ? `Resets in ${E(u - t)}` : void 0,
      style: { display: "grid", gridTemplateColumns: c, alignItems: "center", columnGap: 12, padding: "4px 0" },
      children: [
        /* @__PURE__ */ s("span", { style: { minWidth: 0, display: "flex", flexDirection: "column" }, children: [
          /* @__PURE__ */ i("span", { style: { ...k, fontSize: 13, color: "var(--text)" }, children: e.label }),
          h && /* @__PURE__ */ i("span", { style: { ...g, ...k, fontSize: 11, fontVariantNumeric: "tabular-nums" }, children: h })
        ] }),
        /* @__PURE__ */ i(
          "span",
          {
            role: "progressbar",
            "aria-label": e.label,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": o,
            "data-severity": l,
            style: { height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden" },
            children: /* @__PURE__ */ i("span", { style: { display: "block", height: "100%", width: `${o}%`, background: H[l], borderRadius: 4 } })
          }
        ),
        /* @__PURE__ */ i("span", { style: { fontSize: 13, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", color: K[l] }, children: r == null ? "—" : Y(r) }),
        /* @__PURE__ */ i("span", { style: { ...g, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, children: m })
      ]
    }
  );
}
function Q({ report: e, now: t, compact: n }) {
  var a;
  const r = B(e), l = (a = e.metadata) == null ? void 0 : a.planType, o = e.limits ?? [];
  return /* @__PURE__ */ s(
    "div",
    {
      "data-testid": "omp-usage-account",
      style: { display: "flex", flexDirection: "column", gap: 6, borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "10px 12px" },
      children: [
        /* @__PURE__ */ s("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [
          r && /* @__PURE__ */ i("span", { title: r, style: { ...k, fontSize: 13, fontWeight: 600, color: "var(--text)" }, children: r }),
          l && /* @__PURE__ */ i("span", { style: { ...g, flexShrink: 0, fontSize: 10.5, padding: "0 6px", borderRadius: 4, border: "1px solid var(--border)" }, children: l }),
          e.fetchedAt != null && /* @__PURE__ */ i("span", { style: { ...g, marginLeft: "auto", flexShrink: 0, fontSize: 11 }, children: C(e.fetchedAt, t) })
        ] }),
        o.length === 0 ? /* @__PURE__ */ i("p", { style: { ...g, margin: 0, fontSize: 12 }, children: "No usage data" }) : /* @__PURE__ */ i("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }, children: o.map((d) => /* @__PURE__ */ i(J, { limit: d, now: t, compact: n }, d.id)) })
      ]
    }
  );
}
function X({ data: e, error: t, loading: n, refreshing: r, onRefresh: l, compact: o = !1, now: a = Date.now() }) {
  const d = V(e == null ? void 0 : e.reports), u = t ?? (e && !e.ok ? e.error ?? "OMP usage is unavailable." : null);
  return /* @__PURE__ */ s("div", { "data-testid": "omp-usage-panel", style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ i("style", { children: q }),
    /* @__PURE__ */ s("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: o ? "10px 12px" : "0 0 12px", borderBottom: o ? "1px solid var(--border)" : void 0 }, children: [
      o && /* @__PURE__ */ i("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--text)" }, children: "OMP usage" }),
      e != null && e.fetchedAt ? /* @__PURE__ */ s("span", { style: { ...g, fontSize: 11.5 }, children: [
        "Fetched ",
        C(e.fetchedAt, a)
      ] }) : null,
      /* @__PURE__ */ i(
        "button",
        {
          type: "button",
          "aria-label": "Refresh usage",
          title: "Refresh usage",
          onClick: l,
          disabled: r,
          style: { marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: r ? "default" : "pointer" },
          children: r ? /* @__PURE__ */ i(O, { size: 13, style: _, "data-omp-usage-spin": "" }) : /* @__PURE__ */ i(L, { size: 13 })
        }
      )
    ] }),
    /* @__PURE__ */ s("div", { style: { display: "flex", flexDirection: "column", gap: 16, padding: o ? 12 : "12px 0", maxHeight: o ? "min(70vh, 520px)" : void 0, overflowY: o ? "auto" : void 0 }, children: [
      u && /* @__PURE__ */ s("div", { role: "alert", style: { borderRadius: 8, padding: "10px 12px", background: "var(--danger-subtle)", border: "1px solid var(--danger)", color: "var(--text)", fontSize: 12.5 }, children: [
        /* @__PURE__ */ i("strong", { style: { display: "block", marginBottom: 2 }, children: "Couldn't load OMP usage" }),
        u
      ] }),
      n && !e && /* @__PURE__ */ s("div", { role: "status", style: { ...g, display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }, children: [
        /* @__PURE__ */ i(O, { size: 13, style: _, "data-omp-usage-spin": "", "aria-hidden": "true" }),
        "Loading usage…"
      ] }),
      e && d.length === 0 && !u && /* @__PURE__ */ i("p", { style: { ...g, margin: 0, fontSize: 11.5 }, children: "No accounts reported usage." }),
      d.map((f) => /* @__PURE__ */ s("section", { "data-testid": "omp-usage-provider", style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
        /* @__PURE__ */ s("h3", { style: { ...g, margin: 0, display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }, children: [
          /* @__PURE__ */ i("span", { children: f.provider }),
          /* @__PURE__ */ s("span", { style: { fontWeight: 400, textTransform: "none", letterSpacing: "normal" }, children: [
            "· ",
            f.accounts.length
          ] })
        ] }),
        f.accounts.map((m, h) => {
          var c, p;
          return /* @__PURE__ */ i(Q, { report: m, now: a, compact: o }, `${((c = m.metadata) == null ? void 0 : c.accountId) ?? ((p = m.metadata) == null ? void 0 : p.email) ?? ""}:${h}`);
        })
      ] }, f.provider))
    ] })
  ] });
}
const P = "/apps/omp-usage/api/usage";
function Z() {
  const e = T(), t = w(e);
  t.current = e;
  const { active: n } = D(), r = n !== !1, [l, o] = M(), [a, d] = M(null), [u, f] = M(!0), [m, h] = M(!1), c = w(!0), p = w(!1);
  z(() => (c.current = !0, () => {
    c.current = !1;
  }), []);
  const v = I(async (A) => {
    try {
      const y = await t.current.get(A ? `${P}?refresh=1` : P);
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
    if (!r) return;
    v(!1).then(() => R());
    const A = setInterval(() => {
      v(!1);
    }, W);
    return () => clearInterval(A);
  }, [r, v, R]), { data: l, error: a, loading: u, refreshing: m, refresh: R };
}
function ie() {
  const { data: e, error: t, loading: n, refreshing: r, refresh: l } = Z();
  return /* @__PURE__ */ i(X, { compact: !0, data: e, error: t, loading: n, refreshing: r, onRefresh: l });
}
export {
  ie as default
};
