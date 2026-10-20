import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// "purchasing" (Acheteur): only imports supplier price lists and compares suppliers.
export const userRoleEnum = pgEnum("user_role", ["owner", "administrator", "staff", "purchasing"]);
export const stockStatusEnum = pgEnum("stock_status", [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "on_order",
  "discontinued",
]);
export const monitoringStatusEnum = pgEnum("monitoring_status", ["active", "paused", "archived"]);
export const matchClassEnum = pgEnum("match_class", ["exact", "strong", "possible", "unverified"]);
export const offerConditionEnum = pgEnum("offer_condition", [
  "new",
  "refurbished",
  "used",
  "bundle",
  "unknown",
]);
export const availabilityEnum = pgEnum("availability", [
  "in_stock",
  "out_of_stock",
  "limited",
  "preorder",
  "unknown",
]);
export const connectorStatusEnum = pgEnum("connector_status", [
  "ready",
  "limited",
  "error",
  "disabled",
  "demo",
]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "success", "failed", "partial"]);
export const priceEventEnum = pgEnum("price_event", [
  "increase",
  "decrease",
  "out_of_stock",
  "back_in_stock",
  "new_listing",
  "removed",
  "market_move",
  "unchanged",
]);
export const movementTypeEnum = pgEnum("movement_type", [
  "purchase",
  "sale",
  "return",
  "adjustment",
  "replenishment",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "new_product",
  "price_undercut",
  "below_min_price",
  "price_increase_opportunity",
  "unavailable",
  "back_in_stock",
  "margin_below_min",
  "unprofitable",
  "connector_failure",
  "market_report",
  "system",
]);
export const discoveryStatusEnum = pgEnum("discovery_status", ["new", "added", "ignored", "watchlist"]);
export const pricingStrategyEnum = pgEnum("pricing_strategy", ["competitive", "balanced", "premium"]);

const money = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  city: text("city"),
  country: text("country").default("Tunisia").notNull(),
  phone: text("phone"),
  website: text("website"),
  defaultCurrency: text("default_currency").default("TND").notNull(),
  defaultVatRate: money("default_vat_rate").default("0.190").notNull(),
  purchasePricesIncludeVat: boolean("purchase_prices_include_vat").default(false).notNull(),
  sellingPricesIncludeVat: boolean("selling_prices_include_vat").default(true).notNull(),
  defaultMinMargin: money("default_min_margin").default("0.030").notNull(),
  variableSellingCostRate: money("variable_selling_cost_rate").default("0.015").notNull(),
  monthlyOperatingCosts: money("monthly_operating_costs").default("0").notNull(),
  lowStockThreshold: integer("low_stock_threshold").default(3).notNull(),
  monitoringIntervalMinutes: integer("monitoring_interval_minutes").default(360).notNull(),
  dataRetentionDays: integer("data_retention_days").default(365).notNull(),
  onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
  onboardingStep: integer("onboarding_step").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: userRoleEnum("role").default("staff").notNull(),
    phone: text("phone"),
    jobTitle: text("job_title"),
    avatarUrl: text("avatar_url"),
    isActive: boolean("is_active").default(true).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    index("users_workspace_idx").on(t.workspaceId),
  ],
);

export const userSettings = pgTable("user_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  currency: text("currency").default("TND").notNull(),
  locale: text("locale").default("en-TN").notNull(),
  emailNotifications: boolean("email_notifications").default(true).notNull(),
  inAppNotifications: boolean("in_app_notifications").default(true).notNull(),
  browserNotifications: boolean("browser_notifications").default(false).notNull(),
  weeklyReportEmail: boolean("weekly_report_email").default(true).notNull(),
  quietHoursStart: text("quiet_hours_start").default("22:00"),
  quietHoursEnd: text("quiet_hours_end").default("07:00"),
  alertPriceDropPct: money("alert_price_drop_pct").default("0.030").notNull(),
  monitoredCategories: jsonb("monitored_categories").$type<string[]>().default([]),
  monitoredCompetitorIds: jsonb("monitored_competitor_ids").$type<string[]>().default([]),
  theme: text("theme").default("light").notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const competitors = pgTable(
  "competitors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    websiteUrl: text("website_url").notNull(),
    logoText: text("logo_text"),
    listingUrl: text("listing_url"),
    searchUrlTemplate: text("search_url_template"),
    monitoringFrequencyMinutes: integer("monitoring_frequency_minutes").default(360).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    connectorStatus: connectorStatusEnum("connector_status").default("demo").notNull(),
    connectorNotes: text("connector_notes"),
    lastSuccessfulCheck: timestamp("last_successful_check", { withTimezone: true }),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastError: text("last_error"),
    retryCount: integer("retry_count").default(0).notNull(),
    trackedProductCount: integer("tracked_product_count").default(0).notNull(),
    newListingsCount: integer("new_listings_count").default(0).notNull(),
    priceChangesCount: integer("price_changes_count").default(0).notNull(),
    isBuiltIn: boolean("is_built_in").default(false).notNull(),
    /** Our own web shop: its catalogue is indexed to link our listings, but it is never a competitor. */
    isOwnShop: boolean("is_own_shop").default(false).notNull(),
    isDemo: boolean("is_demo").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("competitors_workspace_idx").on(t.workspaceId), uniqueIndex("competitors_ws_slug_idx").on(t.workspaceId, t.slug)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    brand: text("brand"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    manufacturerRef: text("manufacturer_ref"),
    barcode: text("barcode"),
    sku: text("sku"),
    category: text("category"),
    subcategory: text("subcategory"),
    imageUrl: text("image_url"),
    purchasePrice: money("purchase_price").default("0").notNull(),
    purchaseCurrency: text("purchase_currency").default("TND").notNull(),
    exchangeRate: money("exchange_rate").default("1").notNull(),
    shippingCost: money("shipping_cost").default("0").notNull(),
    importCost: money("import_cost").default("0").notNull(),
    otherCosts: money("other_costs").default("0").notNull(),
    vatRate: money("vat_rate").default("0.190").notNull(),
    minProfitMargin: money("min_profit_margin").default("0.030").notNull(),
    targetSellingPrice: money("target_selling_price"),
    actualSellingPrice: money("actual_selling_price"),
    stockQty: integer("stock_qty").default(0).notNull(),
    stockStatus: stockStatusEnum("stock_status").default("in_stock").notNull(),
    lowStockThreshold: integer("low_stock_threshold").default(3).notNull(),
    supplierName: text("supplier_name"),
    warranty: text("warranty"),
    condition: text("condition").default("new").notNull(),
    description: text("description"),
    specifications: jsonb("specifications").$type<Record<string, string>>().default({}),
    notes: text("notes"),
    tags: jsonb("tags").$type<string[]>().default([]),
    monitoringStatus: monitoringStatusEnum("monitoring_status").default("active").notNull(),
    /** Last automatic search for this product on competitor sites (null = never searched yet). */
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
    // Set client-side too: the local database cannot alter its column default (the old one is "balanced").
    savedStrategy: pricingStrategyEnum("saved_strategy")
      .default("competitive")
      .$defaultFn(() => "competitive"),
    /** Our own listing of this product on our web shop (found automatically by reference). */
    ownUrl: text("own_url"),
    ownTitle: text("own_title"),
    ownPriceTnd: money("own_price_tnd"),
    ownAvailability: text("own_availability"),
    /** found = on our site · review = probable listing to confirm · missing = to add to our site. */
    ownStatus: text("own_status"),
    ownCheckedAt: timestamp("own_checked_at", { withTimezone: true }),
    isDemo: boolean("is_demo").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("products_workspace_idx").on(t.workspaceId),
    index("products_sku_idx").on(t.workspaceId, t.sku),
    index("products_barcode_idx").on(t.workspaceId, t.barcode),
    index("products_ref_idx").on(t.workspaceId, t.manufacturerRef),
    index("products_category_idx").on(t.workspaceId, t.category),
  ],
);

// Product URLs published in each competitor's sitemap, indexed for reference search.
export const competitorCatalog = pgTable(
  "competitor_catalog",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    slugTitle: text("slug_title").notNull(),
    searchKey: text("search_key").notNull(),
    imageUrl: text("image_url"),
    lastmod: timestamp("lastmod", { withTimezone: true }),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("catalog_competitor_idx").on(t.competitorId), uniqueIndex("catalog_competitor_url_idx").on(t.competitorId, t.url)],
);

export const productCompetitorUrls = pgTable(
  "product_competitor_urls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("pcu_product_idx").on(t.productId)],
);

export const competitorOffers = pgTable(
  "competitor_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    brand: text("brand"),
    model: text("model"),
    manufacturerRef: text("manufacturer_ref"),
    barcode: text("barcode"),
    url: text("url"),
    imageUrl: text("image_url"),
    priceTnd: money("price_tnd").notNull(),
    /** For price comparators: the shop offering priceTnd. */
    sellerName: text("seller_name"),
    availability: availabilityEnum("availability").default("unknown").notNull(),
    condition: offerConditionEnum("condition").default("new").notNull(),
    matchClass: matchClassEnum("match_class").default("possible").notNull(),
    matchConfidence: integer("match_confidence").default(50).notNull(),
    matchReason: text("match_reason"),
    excludedFromBenchmark: boolean("excluded_from_benchmark").default(false).notNull(),
    /** Compatible ("adaptable") version of our reference: shown apart, never used in price comparisons. */
    isCompatible: boolean("is_compatible").default(false).notNull(),
    userReview: text("user_review"),
    isDemo: boolean("is_demo").default(true).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).defaultNow().notNull(),
    stale: boolean("stale").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("offers_product_idx").on(t.productId),
    index("offers_competitor_idx").on(t.competitorId),
    index("offers_workspace_idx").on(t.workspaceId),
  ],
);

export const priceObservations = pgTable(
  "price_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => competitorOffers.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
    priceTnd: money("price_tnd").notNull(),
    previousPriceTnd: money("previous_price_tnd"),
    availability: availabilityEnum("availability").default("unknown").notNull(),
    eventType: priceEventEnum("event_type").default("unchanged").notNull(),
    isDemo: boolean("is_demo").default(true).notNull(),
    checkFailed: boolean("check_failed").default(false).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("obs_offer_idx").on(t.offerId, t.observedAt),
    index("obs_product_idx").on(t.productId, t.observedAt),
    index("obs_workspace_idx").on(t.workspaceId, t.observedAt),
  ],
);

export const productMatchReviews = pgTable("product_match_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id")
    .notNull()
    .references(() => competitorOffers.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  note: text("note"),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pricingRecommendations = pgTable("pricing_recommendations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  strategy: pricingStrategyEnum("strategy").notNull(),
  recommendedPrice: money("recommended_price").notNull(),
  expectedProfit: money("expected_profit"),
  expectedMargin: money("expected_margin"),
  explanation: text("explanation"),
  confidence: integer("confidence").default(70).notNull(),
  flaggedLoss: boolean("flagged_loss").default(false).notNull(),
  isDemo: boolean("is_demo").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const discoveredListings = pgTable(
  "discovered_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    brand: text("brand"),
    manufacturerRef: text("manufacturer_ref"),
    category: text("category"),
    priceTnd: money("price_tnd"),
    availability: availabilityEnum("availability").default("in_stock").notNull(),
    url: text("url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    identificationConfidence: integer("identification_confidence").default(70).notNull(),
    alreadyInCatalog: boolean("already_in_catalog").default(false).notNull(),
    matchedProductId: uuid("matched_product_id").references(() => products.id, { onDelete: "set null" }),
    status: discoveryStatusEnum("status").default("new").notNull(),
    isDemo: boolean("is_demo").default(true).notNull(),
    rediscovery: boolean("rediscovery").default(false).notNull(),
  },
  (t) => [index("disc_workspace_idx").on(t.workspaceId, t.firstSeenAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("notif_workspace_idx").on(t.workspaceId, t.createdAt),
    index("notif_dedupe_idx").on(t.workspaceId, t.dedupeKey),
  ],
);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// One supplier price list (PDF, Word, Excel or CSV) uploaded on the purchasing page.
export const supplierPriceImports = pgTable(
  "supplier_price_imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    /** Basis of the prices as written in the file; quotes are always stored HT. */
    priceBasis: text("price_basis").default("ht").notNull(),
    rowCount: integer("row_count").default(0).notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("supplier_imports_workspace_idx").on(t.workspaceId)],
);

export const supplierQuotes = pgTable("supplier_quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  productRef: text("product_ref"),
  productName: text("product_name"),
  quotedPrice: money("quoted_price").notNull(),
  currency: text("currency").default("TND").notNull(),
  moq: integer("moq").default(1).notNull(),
  leadTimeDays: integer("lead_time_days").default(3).notNull(),
  shippingCost: money("shipping_cost").default("0").notNull(),
  availability: text("availability").default("in_stock"),
  quotedAt: timestamp("quoted_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Price list the quote was read from (null = entered by hand). Deleting the import removes its quotes. */
  importId: uuid("import_id").references(() => supplierPriceImports.id, { onDelete: "cascade" }),
});

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: movementTypeEnum("type").notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: money("unit_cost"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("mov_product_idx").on(t.productId, t.createdAt)],
);

export const salesRecords = pgTable(
  "sales_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).defaultNow().notNull(),
    channel: text("channel").default("store"),
    note: text("note"),
  },
  (t) => [index("sales_product_idx").on(t.productId, t.soldAt)],
);

export const monitoringJobs = pgTable(
  "monitoring_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
    status: jobStatusEnum("status").default("queued").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    productsChecked: integer("products_checked").default(0).notNull(),
    changesDetected: integer("changes_detected").default(0).notNull(),
    errorMessage: text("error_message"),
    trigger: text("trigger").default("manual").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("jobs_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const monitoringErrors = pgTable("monitoring_errors", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  competitorId: uuid("competitor_id").references(() => competitors.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => monitoringJobs.id, { onDelete: "set null" }),
  classification: text("classification").notNull(),
  message: text("message").notNull(),
  retryable: boolean("retryable").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const watchlistItems = pgTable("watchlist_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  listingId: uuid("listing_id").references(() => discoveredListings.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Cross-instance lock for the background scheduler (serverless runs can overlap).
export const jobLeases = pgTable("job_leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
});

// Marketing Studio posters. Prices stay in the catalogue: the design only stores layout, texts and the
// promo price typed by the user; every check (old price, margin floor, stock) is recomputed server-side.
export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    productIds: jsonb("product_ids").$type<string[]>().default([]).notNull(),
    design: jsonb("design").$type<Record<string, unknown>>().default({}).notNull(),
    /** Previous designs, newest first (capped), for "revenir à une version précédente". */
    versions: jsonb("versions").$type<Array<{ at: string; design: Record<string, unknown> }>>().default([]).notNull(),
    /** draft · validated (checks passed and confirmed by the user; any edit returns it to draft). */
    status: text("status").default("draft").notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("marketing_campaigns_workspace_idx").on(t.workspaceId, t.updatedAt)],
);

// AI-generated poster backgrounds (no file storage on this deployment: the JPEG is kept as base64).
export const marketingAssets = pgTable(
  "marketing_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => marketingCampaigns.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull(),
    mime: text("mime").default("image/jpeg").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("marketing_assets_workspace_idx").on(t.workspaceId, t.createdAt), index("marketing_assets_campaign_idx").on(t.campaignId)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type MarketingCampaign = typeof marketingCampaigns.$inferSelect;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Competitor = typeof competitors.$inferSelect;
export type CompetitorOffer = typeof competitorOffers.$inferSelect;
export type PriceObservation = typeof priceObservations.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type SupplierQuote = typeof supplierQuotes.$inferSelect;
export type SupplierPriceImport = typeof supplierPriceImports.$inferSelect;
export type DiscoveredListing = typeof discoveredListings.$inferSelect;
export type MonitoringJob = typeof monitoringJobs.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type SalesRecord = typeof salesRecords.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
