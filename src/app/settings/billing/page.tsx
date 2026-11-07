"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { PageHeader } from "@/components/ds/PageHeader";
import { PageShell } from "@/components/ds/PageShell";
import { chipButton, chipButtonPrimary } from "@/components/ds/buttonStyles";
import { useActingAs } from "@/context/ActingAsContext";
import { SELLABLE_PLANS, type BillingCurrency, type BillingInterval, type SellablePlan } from "@/lib/billing/catalog";
import { useT } from "@/lib/i18n/useT";
import { supabase } from "@/lib/supabase/client";

type PriceFlags = Record<SellablePlan, Record<BillingInterval, Record<BillingCurrency, boolean>>>;

type BillingState = {
  plan: string;
  status: string;
  validUntil: string | null;
  cancelAtPeriodEnd: boolean;
  billingCurrency: BillingCurrency | null;
  billingInterval: BillingInterval | null;
  suggestedCurrency: BillingCurrency;
  currencyLocked: boolean;
  hasCustomer: boolean;
  checkoutConfigured: boolean;
  prices: PriceFlags;
};

function stripeHost(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === host;
  } catch {
    return false;
  }
}

export default function BillingPage() {
  const { t, locale } = useT();
  const { actingAsProfileId, actingAsLabel, clearActingAs } = useActingAs();
  const [state, setState] = useState<BillingState | null>(null);
  const [currency, setCurrency] = useState<BillingCurrency | null>(null);
  const [interval, setPlanInterval] = useState<BillingInterval>("month");
  const [checkoutFlag, setCheckoutFlag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (actingAsProfileId) return;
    let stop = false;
    let tries = 0;
    const flag = new URLSearchParams(window.location.search).get("checkout");
    setCheckoutFlag(flag);

    async function load() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || stop) return;
      const response = await fetch("/api/billing/state", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok || stop) return;
      const next = (await response.json()) as BillingState;
      if (stop) return;
      setState(next);
      setCurrency((current) => {
        if (current) return current;
        if (next.currencyLocked && next.billingCurrency) return next.billingCurrency;
        return next.suggestedCurrency;
      });
      if (next.currencyLocked && next.billingInterval) {
        setPlanInterval(next.billingInterval);
      }
      if (flag === "success" && next.status !== "active" && tries < 4) {
        tries += 1;
        window.setTimeout(() => {
          if (!stop) void load();
        }, 2000);
      }
    }

    void load();
    return () => {
      stop = true;
    };
  }, [actingAsProfileId]);

  async function bearer(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function startCheckout(plan: SellablePlan) {
    if (!currency) return;
    setError(null);
    setBusy(plan);
    try {
      const token = await bearer();
      if (!token) return;
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan_key: plan,
          interval,
          currency,
          locale: locale === "ko" ? "ko" : "en",
        }),
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !payload?.url || !stripeHost(payload.url, "checkout.stripe.com")) {
        const key =
          payload?.error === "currency_locked"
            ? "billing.currencyLockedError"
            : payload?.error === "already_subscribed"
              ? "billing.already"
              : payload?.error === "checkout_pending"
                ? "billing.pending"
                : payload?.error === "price_not_configured"
                  ? "billing.priceMissing"
                  : payload?.error === "billing_not_configured"
                    ? "billing.notConfigured"
                    : "billing.error";
        setError(t(key));
        return;
      }
      window.location.assign(payload.url);
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setError(null);
    setBusy("portal");
    try {
      const token = await bearer();
      if (!token) return;
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ locale: locale === "ko" ? "ko" : "en" }),
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !payload?.url || !stripeHost(payload.url, "billing.stripe.com")) {
        setError(t(payload?.error === "billing_not_configured" ? "billing.notConfigured" : "billing.error"));
        return;
      }
      window.location.assign(payload.url);
    } finally {
      setBusy(null);
    }
  }

  if (actingAsProfileId) {
    return (
      <AuthGate>
        <PageShell variant="narrow">
          <PageHeader variant="plain" title={t("billing.title")} />
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">{t("billing.acting.title")}</p>
            <p className="mt-1">
              {t("billing.acting.body").replace("{name}", actingAsLabel || t("billing.acting.someone"))}
            </p>
            <button type="button" onClick={() => clearActingAs()} className={`${chipButtonPrimary} mt-3`}>
              {t("billing.acting.cta")}
            </button>
          </div>
        </PageShell>
      </AuthGate>
    );
  }

  const selectedCurrency = currency ?? state?.suggestedCurrency ?? "usd";
  const locked = state?.currencyLocked === true;
  const when = state?.validUntil
    ? new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium" }).format(
        new Date(state.validUntil),
      )
    : null;

  return (
    <AuthGate>
      <PageShell variant="narrow">
        <PageHeader
          variant="plain"
          title={t("billing.title")}
          lead={t("billing.lead")}
          actions={
            <Link href="/settings" className={chipButton}>
              {t("shell.settings")}
            </Link>
          }
        />
        <p className="mb-6 text-sm text-zinc-600">{t("billing.freeNote")}</p>

        {checkoutFlag === "success" && (
          <p role="status" className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
            {t("billing.checkoutSuccess")}
          </p>
        )}
        {checkoutFlag === "cancel" && (
          <p role="status" className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800">
            {t("billing.checkoutCancel")}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {error}
          </p>
        )}

        <section className="mb-8 rounded-xl border border-zinc-200 px-4 py-3 text-sm">
          <p className="text-zinc-500">{t("billing.current")}</p>
          <p className="mt-1 font-medium text-zinc-900">
            {t(`billing.plan.${state?.plan ?? "free"}`)}
            {" · "}
            {t(`billing.status.${state?.status ?? "free"}`)}
          </p>
          {state?.cancelAtPeriodEnd && when && (
            <p className="mt-1 text-zinc-600">{t("billing.cancelScheduled").replace("{date}", when)}</p>
          )}
          {!state?.cancelAtPeriodEnd && when && state?.status === "active" && (
            <p className="mt-1 text-zinc-600">{t("billing.renews").replace("{date}", when)}</p>
          )}
          {state?.hasCustomer && (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={busy === "portal"}
              className={`${chipButton} mt-3`}
            >
              {t("billing.manage")}
            </button>
          )}
        </section>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["usd", "krw"] as const).map((code) => (
            <button
              key={code}
              type="button"
              disabled={locked}
              aria-pressed={selectedCurrency === code}
              onClick={() => setCurrency(code)}
              className={selectedCurrency === code ? chipButtonPrimary : chipButton}
            >
              {t(`billing.currency.${code}`)}
            </button>
          ))}
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              onClick={() => setPlanInterval(value)}
              className={interval === value ? chipButtonPrimary : chipButton}
            >
              {t(`billing.interval.${value}`)}
            </button>
          ))}
        </div>
        <p className="mb-6 text-sm text-zinc-600">
          {locked && state?.billingCurrency
            ? t("billing.currency.locked").replace("{currency}", t(`billing.currency.${state.billingCurrency}`))
            : t("billing.currency.hint")}
          {interval === "year" ? ` ${t("billing.interval.yearNote")}` : ""}
        </p>

        <div className="flex flex-col gap-3">
          {SELLABLE_PLANS.map((plan) => {
            const ready = state?.prices?.[plan]?.[interval]?.[selectedCurrency] === true;
            const canStart = Boolean(state?.checkoutConfigured) && ready && !locked;
            return (
              <article key={plan} className="rounded-xl border border-zinc-200 px-4 py-3">
                <h2 className="text-base font-medium text-zinc-900">{t(`billing.plan.${plan}`)}</h2>
                <p className="mt-1 text-sm text-zinc-600">{t(`billing.plan.${plan}.blurb`)}</p>
                {!ready && <p className="mt-2 text-xs text-zinc-500">{t("billing.priceMissing")}</p>}
                {state && !state.checkoutConfigured && (
                  <p className="mt-2 text-xs text-zinc-500">{t("billing.notConfigured")}</p>
                )}
                <button
                  type="button"
                  disabled={!canStart || busy === plan}
                  onClick={() => void startCheckout(plan)}
                  className={`${chipButtonPrimary} mt-3 disabled:opacity-40`}
                >
                  {t("billing.subscribe")}
                </button>
              </article>
            );
          })}
        </div>
      </PageShell>
    </AuthGate>
  );
}
