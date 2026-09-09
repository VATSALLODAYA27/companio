-- Companio — initial schema migration
--
-- Hand-authored (not `prisma migrate dev`-generated) because this
-- migration includes a PostGIS geography column and a GIST index that
-- Prisma cannot express declaratively (the column is typed
-- `Unsupported("geography(Point, 4326)")` in schema.prisma). Everything
-- else mirrors what `prisma migrate dev` would produce from that schema
-- exactly, including default column names (camelCase, unquoted field
-- names map 1:1 since no field-level @map is used) and table names from
-- each model's @@map.
--
-- Applied and verified against a live PostgreSQL 16 + PostGIS 3.4 instance.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Enums ───────────────────────────────────────────────────────────
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE "Availability" AS ENUM ('NOW', 'TODAY', 'WEEKEND', 'NOT_AVAILABLE');
CREATE TYPE "VerificationProvider" AS ENUM ('GOOGLE', 'GOVERNMENT_KYC');
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED');
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');
CREATE TYPE "ReportCategory" AS ENUM ('HARASSMENT', 'SPAM', 'FAKE_PROFILE', 'INAPPROPRIATE_BEHAVIOR', 'SUSPICIOUS_ACTIVITY', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- ── users ───────────────────────────────────────────────────────────
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "googleId" TEXT,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
CREATE INDEX "users_status_idx" ON "users"("status");

-- ── sessions ────────────────────────────────────────────────────────
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "userAgentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── profiles ────────────────────────────────────────────────────────
CREATE TABLE "profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "ageRange" TEXT,
    "bio" VARCHAR(280),
    "city" TEXT,
    "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "discoverable" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── activities ──────────────────────────────────────────────────────
CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "activities_key_key" ON "activities"("key");

-- ── user_activities ─────────────────────────────────────────────────
CREATE TABLE "user_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'NOT_AVAILABLE',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_activities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_activities_userId_activityId_key" ON "user_activities"("userId", "activityId");
CREATE INDEX "user_activities_activityId_availability_idx" ON "user_activities"("activityId", "availability");
ALTER TABLE "user_activities" ADD CONSTRAINT "user_activities_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_activities" ADD CONSTRAINT "user_activities_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── user_locations ──────────────────────────────────────────────────
-- `geo` is PostGIS geography(Point,4326) — Prisma's `Unsupported(...)`
-- escape hatch. All spatial querying happens via raw SQL only.
CREATE TABLE "user_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "geo" geography(Point, 4326),
    "geohash6" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_locations_userId_key" ON "user_locations"("userId");
CREATE INDEX "user_locations_geo_gist_idx" ON "user_locations" USING GIST ("geo");
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── verifications ───────────────────────────────────────────────────
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "provider" "VerificationProvider" NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "verifications_userId_status_idx" ON "verifications"("userId", "status");
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── connection_requests ─────────────────────────────────────────────
CREATE TABLE "connection_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requesterId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "connection_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "connection_requests_recipientId_status_idx" ON "connection_requests"("recipientId", "status");
CREATE INDEX "connection_requests_requesterId_status_idx" ON "connection_requests"("requesterId", "status");
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── connections ─────────────────────────────────────────────────────
CREATE TABLE "connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userAId" UUID NOT NULL,
    "userBId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "connections_userAId_userBId_activityId_key" ON "connections"("userAId", "userBId", "activityId");
CREATE INDEX "connections_userAId_idx" ON "connections"("userAId");
CREATE INDEX "connections_userBId_idx" ON "connections"("userBId");
ALTER TABLE "connections" ADD CONSTRAINT "connections_userAId_fkey"
    FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connections" ADD CONSTRAINT "connections_userBId_fkey"
    FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── conversations ───────────────────────────────────────────────────
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connectionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "conversations_connectionId_key" ON "conversations"("connectionId");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── messages ────────────────────────────────────────────────────────
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "messages_conversationId_sentAt_idx" ON "messages"("conversationId", "sentAt");
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── reports ─────────────────────────────────────────────────────────
CREATE TABLE "reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reporterId" UUID NOT NULL,
    "reportedId" UUID NOT NULL,
    "category" "ReportCategory" NOT NULL,
    "details" VARCHAR(1000),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reports_reportedId_status_idx" ON "reports"("reportedId", "status");
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedId_fkey"
    FOREIGN KEY ("reportedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── blocks ──────────────────────────────────────────────────────────
CREATE TABLE "blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blockerId" UUID NOT NULL,
    "blockedId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "blocks_blockerId_blockedId_key" ON "blocks"("blockerId", "blockedId");
CREATE INDEX "blocks_blockedId_idx" ON "blocks"("blockedId");
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerId_fkey"
    FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedId_fkey"
    FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
