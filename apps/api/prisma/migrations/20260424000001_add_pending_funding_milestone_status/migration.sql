-- Migration: Add PENDING_FUNDING to MilestoneStatus enum
-- This status represents milestones that are locked and awaiting customer escrow funding.
-- State flow: DRAFT → PENDING_FUNDING (on lockAll) → FUNDED (on escrow payment) → IN_PROGRESS → SUBMITTED → APPROVED/DISPUTED → RELEASED

ALTER TYPE "MilestoneStatus" ADD VALUE IF NOT EXISTS 'PENDING_FUNDING' AFTER 'LOCKED';
