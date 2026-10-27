import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  competitorOffers,
  competitors,
  monitoringErrors,
  monitoringJobs,
  notifications,
  priceObservations,
  products,
} from "@/db/schema";
import { probeCompetitor } from "@/lib/connectors";
import { fetchLiveOffer } from "@/lib/extract";
import { isPriminiUrl } from "@/lib/matching";
import { sellerExclusions, handledByOfficePc } from "@/lib/catalog";
import { formatTnd, moneyStr, n } from "@/lib/money";
import type { AuthContext } from "@/lib/auth";

const AUTO_NO_OTHER_SELLER = "auto:no_other_seller";

function backoffMinutes(retryCount: number): number {
  return Math.min(24 * 60, 15 * Math.pow(2, Math.min(retryCount, 6)));
}

/**
 * Re-reads the live price of tracked offers. With a `deadline` (serverless runs), only offers that are
 * due are checked, oldest first, and the job stops before the deadline: the competitor stays due and the
 * next run resumes with the remaining offers.
 */
export async function runMonitoringJob(auth: AuthContext, opts?: { competitorId?: string; trigger?: string; deadline?: number }) {
  const started = new Date();
  const [job] = await db
    .insert(monitoringJobs)
    .values({
      workspaceId: auth.workspace.id,
      competitorId: opts?.competitorId ?? null,
      status: "running",
      startedAt: started,
      trigger: opts?.trigger ?? "manual",
    })
    .returning();

  const competitorFilter = opts?.competitorId
    ? and(eq(competitors.workspaceId, auth.workspace.id), eq(competitors.id, opts.competitorId))
    : and(eq(competitors.workspaceId, auth.workspace.id), eq(competitors.enabled, true));

  const sources = await db.select().from(competitors).where(competitorFilter);
  const exclusions = await sellerExclusions(auth.workspace.id);
  let checked = 0;
  let changes = 0;
  let hadError = false;
  let unfinished = false;

  for (const source of sources) {
    if (opts?.deadline && Date.now() > opts.deadline) {
      unfinished = true;
      break;
    }
    // Refused to our server: refreshed by the office-PC task instead (never marked "à vérifier" here).
    if (process.env.VERCEL && handledByOfficePc(source)) continue;
    const probe = await probeCompetitor(source.websiteUrl);
    if (!probe.ok) {
      hadError = true;
      const retry = source.retryCount + 1;
      await db.insert(monitoringErrors).values({
        workspaceId: auth.workspace.id,
        competitorId: source.id,
        jobId: job.id,
        classification: "connectivity",
        message: `Échec de la connexion${probe.status ? ` (HTTP ${probe.status})` : ""} : ${probe.error ?? "site injoignable"}. Les offres n'ont pas été marquées comme supprimées.`,
        retryable: true,
      });
      await db
        .update(competitors)
        .set({
          connectorStatus: "error",
          lastError: probe.error ?? `HTTP ${probe.status ?? "n/a"}`,
          retryCount: retry,
          nextCheckAt: new Date(Date.now() + backoffMinutes(retry) * 60000),
        })
        .where(eq(competitors.id, source.id));

      if (retry >= 3) {
        await insertDedupeNotification(auth, {
          type: "connector_failure",
          title: `${source.name} : échecs répétés`,
          body: "Le site du concurrent est injoignable. Les prix existants sont conservés et marqués à vérifier — une absence de résultat n'est jamais traitée comme une suppression.",
          href: "/competitors",
          competitorId: source.id,
          dedupeKey: `connector:${source.id}:${new Date().toISOString().slice(0, 10)}`,
        });
      }
      continue;
    }

    const offers = await db
      .select()
      .from(competitorOffers)
      .where(and(eq(competitorOffers.workspaceId, auth.workspace.id), eq(competitorOffers.competitorId, source.id)));

    // Checked recently (e.g. earlier in this resumed cycle) = not due yet.
    const freshSince = Date.now() - Math.max(30, source.monitoringFrequencyMinutes - 30) * 60000;
    const toCheck = offers
      // Prices read via Primini are refreshed by the local Primini sync (the comparator refuses our servers).
      .filter((o) => o.userReview !== "reject" && !isPriminiUrl(o.url) && (!opts?.deadline || !o.lastCheckedAt || +o.lastCheckedAt < freshSince))
      .sort((a, b) => +(a.lastCheckedAt ?? 0) - +(b.lastCheckedAt ?? 0));

    let liveChecked = 0;
    for (const offer of toCheck) {
      if (opts?.deadline && Date.now() > opts.deadline) {
        unfinished = true;
        break;
      }
      checked += 1;
      const last = await db
        .select()
        .from(priceObservations)
        .where(eq(priceObservations.offerId, offer.id))
        .orderBy(desc(priceObservations.observedAt))
        .limit(1);
      const previous = last[0];
      const currentPrice = n(offer.priceTnd);
      let nextPrice = currentPrice;
      let nextAvailability = offer.availability;
      let liveSeller: string | null | undefined;
      let event: "unchanged" | "increase" | "decrease" = "unchanged";

      if (!offer.isDemo && offer.url) {
        // Real offer: read the live price from the competitor's public product page.
        const live = await fetchLiveOffer(offer.url, { excludeSellers: exclusions });
        if (!live.ok && live.classification === "no_other_seller") {
          // Comparator lists only us / tracked competitors: hide it from the benchmark until another shop appears.
          await db
            .update(competitorOffers)
            .set({ stale: true, excludedFromBenchmark: true, userReview: AUTO_NO_OTHER_SELLER, lastCheckedAt: new Date() })
            .where(eq(competitorOffers.id, offer.id));
          continue;
        }
        if (!live.ok) {
          hadError = true;
          await db.insert(monitoringErrors).values({
            workspaceId: auth.workspace.id,
            competitorId: source.id,
            jobId: job.id,
            classification: live.classification,
            message: `${offer.title} : ${live.error}. Dernier prix connu conservé.`,
            retryable: live.classification !== "blocked",
          });
          await db.update(competitorOffers).set({ stale: true, lastCheckedAt: new Date() }).where(eq(competitorOffers.id, offer.id));
          continue;
        }
        nextPrice = Math.round(live.offer.priceTnd * 1000) / 1000;
        nextAvailability = live.offer.availability === "unknown" ? offer.availability : live.offer.availability;
        liveSeller = live.offer.seller ?? null;
        liveChecked += 1;
        // Compatible offers stay excluded from comparisons whatever happens to them.
        if (offer.userReview === AUTO_NO_OTHER_SELLER && !offer.isCompatible) {
          await db.update(competitorOffers).set({ excludedFromBenchmark: false, userReview: null }).where(eq(competitorOffers.id, offer.id));
        }
      } else if (offer.isDemo && Math.abs(Math.sin(Date.now() / 8.64e7 + offer.title.length)) > 0.72) {
        // Demo sources may apply a tiny labelled variation so the monitoring timeline is visible.
        // This is never treated as a live scraped price.
        const delta = currentPrice * (Math.sin(offer.title.length) > 0 ? -0.012 : 0.01);
        nextPrice = Math.max(1, Math.round((currentPrice + delta) * 1000) / 1000);
      }

      if ((previous && !previous.checkFailed) || !offer.isDemo) {
        const prevPrice = previous && !previous.checkFailed ? n(previous.priceTnd) : currentPrice;
        if (nextPrice < prevPrice * 0.995) event = "decrease";
        else if (nextPrice > prevPrice * 1.005) event = "increase";
      }

      const unchangedSame =
        previous &&
        !previous.checkFailed &&
        n(previous.priceTnd) === nextPrice &&
        previous.availability === nextAvailability;

      await db
        .update(competitorOffers)
        .set({
          priceTnd: moneyStr(nextPrice),
          availability: nextAvailability,
          ...(liveSeller !== undefined ? { sellerName: liveSeller } : {}),
          lastCheckedAt: new Date(),
          stale: false,
        })
        .where(eq(competitorOffers.id, offer.id));

      if (unchangedSame) {
        continue;
      }

      await db.insert(priceObservations).values({
        workspaceId: auth.workspace.id,
        offerId: offer.id,
        productId: offer.productId,
        competitorId: source.id,
        priceTnd: moneyStr(nextPrice),
        previousPriceTnd: previous ? previous.priceTnd : offer.isDemo ? null : offer.priceTnd,
        availability: nextAvailability,
        eventType: event,
        isDemo: offer.isDemo,
        checkFailed: false,
      });

      if (event !== "unchanged") {
        changes += 1;
        if (offer.productId) {
          const [product] = await db.select().from(products).where(eq(products.id, offer.productId)).limit(1);
          // Our price: the selling price when set, otherwise the live price on our own shop (numedia.tn).
          const ourPrice = product ? n(product.actualSellingPrice) || n(product.ownPriceTnd) : 0;
          if (product && event === "decrease" && ourPrice > nextPrice) {
            await insertDedupeNotification(auth, {
              type: "price_undercut",
              title: `${source.name} a baissé ${product.name}`,
              body: `${source.name} est maintenant à ${formatTnd(nextPrice)}${offer.isDemo ? " (relevé démo)" : ""}. Votre prix : ${formatTnd(ourPrice)}.`,
              href: `/products/${product.id}`,
              productId: product.id,
              competitorId: source.id,
              dedupeKey: `undercut:${product.id}:${source.id}:${nextPrice.toFixed(3)}`,
            });
          }
          if (product && event === "increase") {
            await insertDedupeNotification(auth, {
              type: "price_increase_opportunity",
              title: `${source.name} a augmenté ${product.name}`,
              body: `Le concurrent est passé à ${formatTnd(nextPrice)}. Vérifiez si vous pouvez récupérer de la marge.`,
              href: `/products/${product.id}`,
              productId: product.id,
              competitorId: source.id,
              dedupeKey: `up:${product.id}:${source.id}:${nextPrice.toFixed(3)}`,
            });
          }
        }
      }
    }

    if (unfinished) break; // keep nextCheckAt: the next run continues with this competitor

    await db
      .update(competitors)
      .set({
        lastSuccessfulCheck: new Date(),
        nextCheckAt: new Date(Date.now() + source.monitoringFrequencyMinutes * 60000),
        lastError: null,
        retryCount: 0,
        connectorStatus: liveChecked > 0 ? "ready" : source.isDemo ? "demo" : "limited",
        priceChangesCount: source.priceChangesCount + changes,
        trackedProductCount: offers.length,
      })
      .where(eq(competitors.id, source.id));
  }

  await db
    .update(monitoringJobs)
    .set({
      status: hadError ? (checked > 0 ? "partial" : "failed") : "success",
      finishedAt: new Date(),
      productsChecked: checked,
      changesDetected: changes,
    })
    .where(eq(monitoringJobs.id, job.id));

  return { jobId: job.id, checked, changes, hadError };
}

async function insertDedupeNotification(
  auth: AuthContext,
  input: {
    type: typeof notifications.$inferInsert.type;
    title: string;
    body: string;
    href: string;
    productId?: string | null;
    competitorId?: string | null;
    dedupeKey: string;
  },
) {
  const existing = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.workspaceId, auth.workspace.id), eq(notifications.dedupeKey, input.dedupeKey)))
    .limit(1);
  if (existing.length) return;
  await db.insert(notifications).values({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    type: input.type,
    title: input.title,
    body: input.body,
    href: input.href,
    productId: input.productId ?? null,
    competitorId: input.competitorId ?? null,
    dedupeKey: input.dedupeKey,
  });
}
