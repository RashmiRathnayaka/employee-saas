-- GET /notifications lists one user's notifications newest first.
-- CreateIndex
CREATE INDEX "notifications_companyId_userId_createdAt_idx" ON "notifications"("companyId", "userId", "createdAt");
