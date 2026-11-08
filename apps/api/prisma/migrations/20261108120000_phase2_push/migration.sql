-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "PushMessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "deviceName" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_settings" (
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushDisabledCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_settings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "push_messages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "pushDeviceId" TEXT NOT NULL,
    "status" "PushMessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expoTicketId" TEXT,
    "errorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "receiptCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_expoPushToken_key" ON "push_devices"("expoPushToken");

-- CreateIndex
CREATE INDEX "push_devices_companyId_userId_idx" ON "push_devices"("companyId", "userId");

-- CreateIndex
CREATE INDEX "user_notification_settings_companyId_idx" ON "user_notification_settings"("companyId");

-- CreateIndex
CREATE INDEX "push_messages_companyId_idx" ON "push_messages"("companyId");

-- CreateIndex
CREATE INDEX "push_messages_createdAt_idx" ON "push_messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_messages_notificationId_pushDeviceId_key" ON "push_messages"("notificationId", "pushDeviceId");

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_messages" ADD CONSTRAINT "push_messages_pushDeviceId_fkey" FOREIGN KEY ("pushDeviceId") REFERENCES "push_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written from here on (not expressible in schema.prisma); see
-- docs/phase2/database-schema-phase2.md, push_messages.

-- The sender's claim: one company's PENDING rows that are due (architecture-phase2 section 4.3a).
CREATE INDEX "push_messages_pending_idx" ON "push_messages" ("companyId", "nextAttemptAt") WHERE "status" = 'PENDING';

-- The receipt checker: one company's SENT rows, by when they were sent.
CREATE INDEX "push_messages_sent_idx" ON "push_messages" ("companyId", "sentAt") WHERE "status" = 'SENT';
