-- CreateEnum
CREATE TYPE "BrokerType" AS ENUM ('METATRADER', 'KITE_CONNECT');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REMOVED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('PINE_SCRIPT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RiskAction" AS ENUM ('APPROVE', 'REJECT', 'RESIZE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'SENT', 'FILLED', 'REJECTED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('INVESTOR', 'BROKER');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED_NOT_CONFIGURED');

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "broker_whatsapp_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_signals" (
    "id" TEXT NOT NULL,
    "group_id" TEXT,
    "headline" TEXT NOT NULL,
    "source_url" TEXT,
    "sector" TEXT,
    "bull_case" TEXT NOT NULL,
    "bear_case" TEXT NOT NULL,
    "risk_note" TEXT NOT NULL,
    "confidence_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "broker_type" "BrokerType" NOT NULL,
    "broker_account_ref" TEXT NOT NULL,
    "risk_profile_id" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "whatsapp_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_profiles" (
    "id" TEXT NOT NULL,
    "fixed_lots" DECIMAL(10,4) NOT NULL DEFAULT 0.01,
    "max_daily_loss_percent" DECIMAL(5,2),
    "max_open_positions" INTEGER,
    "risk_reward_ratio" DECIMAL(5,2) DEFAULT 2.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "webhook_secret_encrypted" TEXT NOT NULL,
    "algo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_decisions" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "action" "RiskAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "position_size" DECIMAL(18,4),
    "take_profit" DECIMAL(18,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "risk_decision_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "broker_order_ref" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "algo_id" TEXT,
    "protective_trigger_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "member_id" TEXT,
    "group_id" TEXT,
    "order_id" TEXT,
    "message" TEXT NOT NULL,
    "whatsapp_status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kill_switch_events" (
    "id" TEXT NOT NULL,
    "member_id" TEXT,
    "group_id" TEXT,
    "triggered_by" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "kill_switch_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_risk_profile_id_key" ON "members"("risk_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_risk_decision_id_key" ON "orders"("risk_decision_id");

-- AddForeignKey
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_risk_profile_id_fkey" FOREIGN KEY ("risk_profile_id") REFERENCES "risk_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_decisions" ADD CONSTRAINT "risk_decisions_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_decisions" ADD CONSTRAINT "risk_decisions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_risk_decision_id_fkey" FOREIGN KEY ("risk_decision_id") REFERENCES "risk_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switch_events" ADD CONSTRAINT "kill_switch_events_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kill_switch_events" ADD CONSTRAINT "kill_switch_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
