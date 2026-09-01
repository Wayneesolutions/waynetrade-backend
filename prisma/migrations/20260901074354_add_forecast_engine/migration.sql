-- CreateTable
CREATE TABLE "forecast_predictions" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price_at_prediction" DECIMAL(18,4) NOT NULL,
    "technical_direction" TEXT NOT NULL,
    "technical_confidence" DECIMAL(5,2) NOT NULL,
    "technical_basis" TEXT NOT NULL,
    "n_samples" INTEGER,
    "predicted_low" DECIMAL(18,4) NOT NULL,
    "predicted_high" DECIMAL(18,4) NOT NULL,
    "horizon_days" INTEGER NOT NULL DEFAULT 5,
    "event_summary" TEXT,
    "event_direction" TEXT,
    "event_confidence_label" TEXT,
    "target_date" TIMESTAMP(3) NOT NULL,
    "outcome_checked" BOOLEAN NOT NULL DEFAULT false,
    "actual_price" DECIMAL(18,4),
    "direction_correct" BOOLEAN,
    "price_error_pct" DECIMAL(10,4),

    CONSTRAINT "forecast_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_watchlist_items" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "display_name" TEXT,
    "alert_threshold" DECIMAL(5,2) NOT NULL DEFAULT 65.0,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forecast_predictions_ticker_idx" ON "forecast_predictions"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_watchlist_items_ticker_key" ON "forecast_watchlist_items"("ticker");
