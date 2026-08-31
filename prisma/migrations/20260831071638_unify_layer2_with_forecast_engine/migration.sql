-- AlterTable
ALTER TABLE "research_signals" ADD COLUMN     "technical_confidence" DOUBLE PRECISION,
ADD COLUMN     "technical_direction" TEXT,
ADD COLUMN     "technical_reliability_tier" TEXT,
ADD COLUMN     "technical_sample_size" INTEGER,
ADD COLUMN     "ticker" TEXT;
