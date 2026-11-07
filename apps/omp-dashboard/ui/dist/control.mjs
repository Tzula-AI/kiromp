import { jsxs as s, jsx as r } from "react/jsx-runtime";
import { useAppApi as L, useAppInfo as D, useNavigate as U } from "@kirocrew/app-sdk";
import { Loader2 as O, RefreshCw as C } from "lucide-react";
import { useRef as k, useState as A, useEffect as z, useCallback as E } from "react";
const F = "/apps/omp-dashboard/api", W = "/apps/omp-dashboard", G = 0.75, j = 0.9, B = 6e4;
function V(e) {
  var n;
  if (e.status === "exhausted") return 1;
  const t = (n = e.amount) == null ? void 0 : n.usedFraction;
  return typeof t == "number" && Number.isFinite(t) ? Math.max(0, t) : null;
}
function Y(e) {
  return e == null ? "ok" : e >= j ? "danger" : e >= G ? "warn" : "ok";
}
function H(e) {
  const t = e.metadata;
  return t != null && t.email ? t.email : t != null && t.orgName ? t.orgName : t != null && t.accountId ? t.accountId.slice(0, 8) : null;
}
function K(e) {
  const t = /* @__PURE__ */ new Map();
  for (const n of e ?? []) {
    let i = t.get(n.provider);
    i || (i = { provider: n.provider, accounts: [] }, t.set(n.provider, i)), i.accounts.push(n);
  }
  return [...t.values()];
}
const S = 6e4, x = 60 * S, b = 24 * x;
function q(e) {
  return `${Math.round(e * 100)}%`;
}
function I(e) {
  return e.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
function $(e) {
  return e >= b ? _([[Math.floor(e / b), "d"], [Math.floor(e % b / x), "h"]]) : e >= x ? _([[Math.floor(e / x), "h"], [Math.floor(e % x / S), "m"]]) : `${Math.max(1, Math.floor(e / S))}m`;
}
function _(e) {
  return e.filter(([t]) => t > 0).map(([t, n]) => `${t}${n}`).join(" ");
}
function T(e, t) {
  const n = Math.max(0, t - e);
  return n < S ? "just now" : n < x ? `${Math.floor(n / S)}m ago` : n < b ? `${Math.floor(n / x)}h ago` : `${Math.floor(n / b)}d ago`;
}
const J = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, Q = {
  ok: "var(--text)",
  warn: "var(--warn)",
  danger: "var(--danger)"
}, g = { color: "var(--muted)" }, w = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, N = { animation: "omp-usage-spin 1s linear infinite" }, X = "@keyframes omp-usage-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[data-omp-usage-spin]{animation:none!important}}";
function Z({ limit: e, now: t, compact: n }) {
  var f;
  const i = V(e), l = Y(i), o = i == null ? 0 : Math.min(100, Math.round(i * 100)), a = e.amount, u = (a == null ? void 0 : a.used) != null && a.limit != null && a.unit !== "percent", c = (f = e.window) == null ? void 0 : f.resetsAt, p = c != null && c > t, m = c == null ? "" : p ? `↻ ${$(c - t)}` : "Resets momentarily", h = u ? `${I(a.used)} / ${I(a.limit)} ${a.unit ?? ""}`.trim() : "", d = n ? "minmax(0,1fr) 48px 38px 64px" : "minmax(0,1fr) 120px 48px 76px";
  return /* @__PURE__ */ s(
    "li",
    {
      "data-testid": "omp-usage-limit",
      title: p ? `Resets in ${$(c - t)}` : void 0,
      style: { display: "grid", gridTemplateColumns: d, alignItems: "center", columnGap: 12, padding: "4px 0" },
      children: [
        /* @__PURE__ */ s("span", { style: { minWidth: 0, display: "flex", flexDirection: "column" }, children: [
          /* @__PURE__ */ r("span", { style: { ...w, fontSize: 13, color: "var(--text)" }, children: e.label }),
          h && /* @__PURE__ */ r("span", { style: { ...g, ...w, fontSize: 11, fontVariantNumeric: "tabular-nums" }, children: h })
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
            children: /* @__PURE__ */ r("span", { style: { display: "block", height: "100%", width: `${o}%`, background: J[l], borderRadius: 4 } })
          }
        ),
        /* @__PURE__ */ r("span", { style: { fontSize: 13, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", color: Q[l] }, children: i == null ? "—" : q(i) }),
        /* @__PURE__ */ r("span", { style: { ...g, fontSize: 11.5, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }, children: m })
      ]
    }
  );
}
function ee({ report: e, now: t, compact: n }) {
  var a;
  const i = H(e), l = (a = e.metadata) == null ? void 0 : a.planType, o = e.limits ?? [];
  return /* @__PURE__ */ s(
    "div",
    {
      "data-testid": "omp-usage-account",
      style: { display: "flex", flexDirection: "column", gap: 6, borderRadius: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "10px 12px" },
      children: [
        /* @__PURE__ */ s("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [
          i && /* @__PURE__ */ r("span", { title: i, style: { ...w, fontSize: 13, fontWeight: 600, color: "var(--text)" }, children: i }),
          l && /* @__PURE__ */ r("span", { style: { ...g, flexShrink: 0, fontSize: 10.5, padding: "0 6px", borderRadius: 4, border: "1px solid var(--border)" }, children: l }),
          e.fetchedAt != null && /* @__PURE__ */ r("span", { style: { ...g, marginLeft: "auto", flexShrink: 0, fontSize: 11 }, children: T(e.fetchedAt, t) })
        ] }),
        o.length === 0 ? /* @__PURE__ */ r("p", { style: { ...g, margin: 0, fontSize: 12 }, children: "No usage data" }) : /* @__PURE__ */ r("ul", { style: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }, children: o.map((u) => /* @__PURE__ */ r(Z, { limit: u, now: t, compact: n }, u.id)) })
      ]
    }
  );
}
function te({ data: e, error: t, loading: n, refreshing: i, onRefresh: l, compact: o = !1, now: a = Date.now() }) {
  const u = K(e == null ? void 0 : e.reports), c = t ?? (e && !e.ok ? e.error ?? "OMP usage is unavailable." : null);
  return /* @__PURE__ */ s("div", { "data-testid": "omp-usage-panel", style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ r("style", { children: X }),
    /* @__PURE__ */ s("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: o ? "10px 12px" : "0 0 12px", borderBottom: o ? "1px solid var(--border)" : void 0 }, children: [
      o && /* @__PURE__ */ r("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--text)" }, children: "OMP usage" }),
      e != null && e.fetchedAt ? /* @__PURE__ */ s("span", { style: { ...g, fontSize: 11.5 }, children: [
        "Fetched ",
        T(e.fetchedAt, a)
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
          children: i ? /* @__PURE__ */ r(O, { size: 13, style: N, "data-omp-usage-spin": "" }) : /* @__PURE__ */ r(C, { size: 13 })
        }
      )
    ] }),
    /* @__PURE__ */ s("div", { style: { display: "flex", flexDirection: "column", gap: 16, padding: o ? 12 : "12px 0", maxHeight: o ? "min(70vh, 520px)" : void 0, overflowY: o ? "auto" : void 0 }, children: [
      c && /* @__PURE__ */ s("div", { role: "alert", style: { borderRadius: 8, padding: "10px 12px", background: "var(--danger-subtle)", border: "1px solid var(--danger)", color: "var(--text)", fontSize: 12.5 }, children: [
        /* @__PURE__ */ r("strong", { style: { display: "block", marginBottom: 2 }, children: "Couldn't load OMP usage" }),
        c
      ] }),
      n && !e && /* @__PURE__ */ s("div", { role: "status", style: { ...g, display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }, children: [
        /* @__PURE__ */ r(O, { size: 13, style: N, "data-omp-usage-spin": "", "aria-hidden": "true" }),
        "Loading usage…"
      ] }),
      e && u.length === 0 && !c && /* @__PURE__ */ r("p", { style: { ...g, margin: 0, fontSize: 11.5 }, children: "No accounts reported usage." }),
      u.map((p) => /* @__PURE__ */ s("section", { "data-testid": "omp-usage-provider", style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
        /* @__PURE__ */ s("h3", { style: { ...g, margin: 0, display: "flex", alignItems: "baseline", gap: 6, fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }, children: [
          /* @__PURE__ */ r("span", { children: p.provider }),
          /* @__PURE__ */ s("span", { style: { fontWeight: 400, textTransform: "none", letterSpacing: "normal" }, children: [
            "· ",
            p.accounts.length
          ] })
        ] }),
        p.accounts.map((m, h) => {
          var d, f;
          return /* @__PURE__ */ r(ee, { report: m, now: a, compact: o }, `${((d = m.metadata) == null ? void 0 : d.accountId) ?? ((f = m.metadata) == null ? void 0 : f.email) ?? ""}:${h}`);
        })
      ] }, p.provider))
    ] })
  ] });
}
const P = `${F}/usage`;
function ne() {
  const e = L(), t = k(e);
  t.current = e;
  const { active: n } = D(), i = n !== !1, [l, o] = A(), [a, u] = A(null), [c, p] = A(!0), [m, h] = A(!1), d = k(!0), f = k(!1);
  z(() => (d.current = !0, () => {
    d.current = !1;
  }), []);
  const v = E(async (M) => {
    try {
      const y = await t.current.get(M ? `${P}?refresh=1` : P);
      if (!d.current) return;
      o(y), u(null);
    } catch (y) {
      d.current && u(y instanceof Error ? y.message : String(y));
    } finally {
      d.current && p(!1);
    }
  }, []), R = E(() => {
    f.current || (f.current = !0, h(!0), v(!0).finally(() => {
      f.current = !1, d.current && h(!1);
    }));
  }, [v]);
  return z(() => {
    if (!i) return;
    v(!1).then(() => R());
    const M = setInterval(() => {
      v(!1);
    }, B);
    return () => clearInterval(M);
  }, [i, v, R]), { data: l, error: a, loading: c, refreshing: m, refresh: R };
}
function se({ onClose: e }) {
  const { data: t, error: n, loading: i, refreshing: l, refresh: o } = ne(), a = U();
  return /* @__PURE__ */ s("div", { style: { display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ r(te, { compact: !0, data: t, error: n, loading: i, refreshing: l, onRefresh: o }),
    /* @__PURE__ */ r("div", { style: { padding: "8px 12px", borderTop: "1px solid var(--border)" }, children: /* @__PURE__ */ r(
      "button",
      {
        type: "button",
        "data-testid": "open-limits",
        onClick: () => {
          e == null || e(), a(`${W}?tab=limits`);
        },
        style: { padding: 0, border: 0, background: "none", color: "var(--accent)", font: "inherit", fontSize: 12, cursor: "pointer" },
        children: "Open Limits →"
      }
    ) })
  ] });
}
export {
  se as default
};
