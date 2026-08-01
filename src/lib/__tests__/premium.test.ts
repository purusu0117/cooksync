import { describe, it, expect, afterEach } from "vitest";
import {
  EXTERNAL_PAYMENT_URL,
  NOT_CONFIGURED_MESSAGE,
  PAYWALL_ON_FIRST_LAUNCH,
  PREMIUM_FEATURES,
  getPurchaseAdapter,
  notConfiguredAdapter,
  plannedFeatures,
  quotaPaywallBody,
  resetPurchaseAdapter,
  sellableFeatures,
  setPurchaseAdapter,
  shouldShowQuotaPaywall,
  type PurchaseAdapter,
} from "../premium";
import {
  APPLE_FAMILY_SHARING_ENABLED,
  FAMILY_PLAN,
  FREE_TRIAL_DAYS,
  PLANS,
  PREMIUM_AI_COST_CAP_YEN,
  grossProfitYen,
  grossProfitWithoutCostCapYen,
  monthlyNetYen,
  netYen,
  premiumWorstCaseCostYen,
  withinUserCostCap,
  yearlyDiscountPercent,
  yearlyNetYen,
} from "../pricing";

// ---------------------------------------------------------------- 特典の設計

describe("プレミアムは足すだけ（無料から取り上げない）", () => {
  it("すべての特典に freeKeeps（無料のままできること）が書いてある", () => {
    for (const f of PREMIUM_FEATURES) {
      // 空文字＝「無料から取り上げた」ということ。設計としてここで落とす。
      expect(f.freeKeeps.trim().length, `${f.id} の freeKeeps が空`).toBeGreaterThan(0);
    }
  });

  it("すべての特典に実装の在処（source）がある", () => {
    for (const f of PREMIUM_FEATURES) {
      expect(f.source.trim().length, `${f.id} の source が空`).toBeGreaterThan(0);
    }
  });

  it("売ってよいのは shipped だけ（2.3.1: 実装にない機能を謳わない）", () => {
    expect(sellableFeatures().every((f) => f.status === "shipped")).toBe(true);
    expect(plannedFeatures().every((f) => f.status === "planned")).toBe(true);
    // 2つに分けて漏れがない（全特典はどちらかに必ず入る）
    expect(sellableFeatures().length + plannedFeatures().length).toBe(
      PREMIUM_FEATURES.length,
    );
  });

  it("id が重複していない", () => {
    const ids = PREMIUM_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ------------------------------------------------------------ 課金画面の時機

describe("課金画面を出す条件", () => {
  it("初回起動では出さない（審査5.1.1(v)・Day1離脱の両面）", () => {
    expect(PAYWALL_ON_FIRST_LAUNCH).toBe(false);
  });

  it("アプリ内から外部決済へ誘導しない（審査3.1.1）", () => {
    expect(EXTERNAL_PAYMENT_URL).toBeNull();
  });

  const base = { premium: false, currentWeek: "W2026-07-27" } as const;

  it("本人の枠切れ（reason:user）なら出す", () => {
    expect(shouldShowQuotaPaywall({ ...base, reason: "user" })).toBe(true);
  });

  it("プレミアムの人には出さない", () => {
    expect(shouldShowQuotaPaywall({ ...base, reason: "user", premium: true })).toBe(false);
  });

  it("こちら側の都合（ip/global/budget）では出さない＝解決しないものを売らない", () => {
    for (const reason of ["ip", "global", "budget"] as const) {
      expect(shouldShowQuotaPaywall({ ...base, reason })).toBe(false);
    }
    // 理由不明（quotaが無い失敗）でも出さない
    expect(shouldShowQuotaPaywall({ ...base, reason: undefined })).toBe(false);
  });

  it("同じ週に2回出さない。週が変われば（枠が戻った後なら）また出せる", () => {
    expect(
      shouldShowQuotaPaywall({ ...base, reason: "user", lastShownWeek: "W2026-07-27" }),
    ).toBe(false);
    expect(
      shouldShowQuotaPaywall({ ...base, reason: "user", lastShownWeek: "W2026-07-20" }),
    ).toBe(true);
  });

  it("枠切れシートの本文は「いつ戻るか」から始まる（先に課金を出さない）", () => {
    const body = quotaPaywallBody("月曜に戻ります");
    expect(body.startsWith("月曜に戻ります")).toBe(true);
    expect(body).toContain("プレミアム");
  });
});

// ------------------------------------------------------------- 購入の口

describe("購入アダプタ", () => {
  afterEach(() => resetPurchaseAdapter());

  it("未設定のあいだは「準備中」と正直に返す（偽ボタンにしない）", async () => {
    const adapter = getPurchaseAdapter();
    expect(adapter.available()).toBe(false);
    const r = await adapter.purchase("monthly");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not-configured");
      expect(r.message).toBe(NOT_CONFIGURED_MESSAGE);
    }
    const restore = await adapter.restore();
    expect(restore.ok).toBe(false);
  });

  it("本物のアダプタを挿したら差し替わり、リセットで既定に戻る", async () => {
    const real: PurchaseAdapter = {
      available: () => true,
      purchase: async (plan) => ({ ok: true, plan }),
      restore: async () => ({ ok: true, plan: "monthly" }),
    };
    setPurchaseAdapter(real);
    expect(getPurchaseAdapter().available()).toBe(true);
    const r = await getPurchaseAdapter().purchase("yearly");
    expect(r).toEqual({ ok: true, plan: "yearly" });

    resetPurchaseAdapter();
    expect(getPurchaseAdapter()).toBe(notConfiguredAdapter);
  });
});

// ---------------------------------------------------------------- 採算

describe("価格と採算（pricing.ts の検算をテストで固定する）", () => {
  it("手取り: ¥480 → ¥371、¥4,800 → ¥3,709", () => {
    expect(monthlyNetYen()).toBe(371);
    expect(yearlyNetYen()).toBe(3709);
    expect(netYen(480)).toBe(371);
  });

  it("年額は「2ヶ月ぶん無料」＝17%オフと食い違わない", () => {
    expect(yearlyDiscountPercent()).toBe(17);
  });

  it("原価上限を入れた後は両プランとも黒字（これがリリース条件）", () => {
    expect(grossProfitYen("monthly")).toBeGreaterThan(0);
    expect(grossProfitYen("yearly")).toBeGreaterThan(0);
  });

  it("回数上限だけでは赤字＝原価上限（¥220）が要る理由", () => {
    expect(grossProfitWithoutCostCapYen("monthly")).toBeLessThan(0);
    expect(grossProfitWithoutCostCapYen("yearly")).toBeLessThan(0);
    expect(premiumWorstCaseCostYen()).toBeGreaterThan(PREMIUM_AI_COST_CAP_YEN);
  });

  it("withinUserCostCap は上限ちょうどまで許す", () => {
    expect(withinUserCostCap(0, PREMIUM_AI_COST_CAP_YEN)).toBe(true);
    expect(withinUserCostCap(PREMIUM_AI_COST_CAP_YEN, 1)).toBe(false);
  });

  it("プランは月額と年額の2つだけ。Product ID は重複しない", () => {
    expect(PLANS.map((p) => p.id).sort()).toEqual(["monthly", "yearly"]);
    const productIds = PLANS.map((p) => p.productId);
    expect(new Set(productIds).size).toBe(productIds.length);
    // App Store Connect 側と同じ文字列にする約束（変えるときは両方直す）
    expect(productIds).toEqual([
      "com.cooksync.premium.monthly",
      "com.cooksync.premium.yearly",
    ]);
  });

  it("出さないと決めたものが出ていない（ファミリープラン・無料トライアル）", () => {
    expect(FAMILY_PLAN).toBeNull();
    expect(APPLE_FAMILY_SHARING_ENABLED).toBe(false);
    expect(FREE_TRIAL_DAYS).toBe(0);
  });
});
