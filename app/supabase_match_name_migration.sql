-- Migration: add name column to matches table
-- Run in Supabase SQL Editor after supabase_watch_migration.sql

ALTER TABLE matches ADD COLUMN IF NOT EXISTS name text;
