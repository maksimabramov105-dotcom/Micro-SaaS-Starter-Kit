-- Migration: add Resume.templateId with a safe default
-- Additive-only: no columns dropped, no breaking changes.

ALTER TABLE "Resume"
  ADD COLUMN IF NOT EXISTS "templateId" TEXT NOT NULL DEFAULT 'modern_minimalist';
