import Stripe from "stripe";

export type StampActiveSubscriptionsConfig = {
  stripeSecretKey: string;
  limit?: number;
  createdWithinDays?: number;
};

export type StampSubscriptionError = {
  subscriptionId: string;
  error: string;
};

export type StampActiveSubscriptionsResult = {
  processed: number;
  updated: number;
  skipped: number;
  errors: StampSubscriptionError[];
};

export async function stampActiveSubscriptions(
  config: StampActiveSubscriptionsConfig,
): Promise<StampActiveSubscriptionsResult> {
  const { stripeSecretKey, limit, createdWithinDays = 30 } = config;

  if (!stripeSecretKey) {
    throw new Error("stripeSecretKey is required");
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2025-02-24.acacia",
  });

  const result: StampActiveSubscriptionsResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const createdGte = Number.isFinite(createdWithinDays)
    ? Math.floor(Date.now() / 1000 - createdWithinDays * 24 * 60 * 60)
    : undefined;

  console.log(
    createdGte
      ? `📅 Applying date filter: created >= ${new Date(createdGte * 1000).toISOString()} (${createdWithinDays} days)`
      : "📅 Date filter disabled (createdWithinDays=Infinity)",
  );

  const listParams: Stripe.SubscriptionListParams = {
    status: "active",
    limit: 100,
    ...(createdGte ? { created: { gte: createdGte } } : {}),
  };

  for await (const subscription of stripe.subscriptions.list(listParams)) {
    if (typeof limit === "number" && result.processed >= limit) {
      break;
    }

    result.processed += 1;

    if (subscription.metadata?.updated) {
      result.skipped += 1;
      continue;
    }

    try {
      await stripe.subscriptions.update(subscription.id, {
        metadata: {
          ...subscription.metadata,
          updated: Date.now().toString(),
        },
      });
      result.updated += 1;
      console.log(`✅ Updated subscription ${subscription.id}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        subscriptionId: subscription.id,
        error: errorMessage,
      });
      console.error(`❌ Failed to update ${subscription.id}: ${errorMessage}`);
    }
  }

  return result;
}

(async () => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    console.error("Missing STRIPE_SECRET_KEY environment variable");
    return;
  }

  const summary = await stampActiveSubscriptions({
    stripeSecretKey,
    createdWithinDays: 30,
  });

  console.table([
    { metric: "processed", value: summary.processed },
    { metric: "updated", value: summary.updated },
    { metric: "skipped", value: summary.skipped },
    { metric: "errors", value: summary.errors.length },
  ]);

  if (summary.errors.length > 0) {
    console.table(summary.errors);
  }
})();
