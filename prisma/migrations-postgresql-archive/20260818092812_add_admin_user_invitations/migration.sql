-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AdminUserInvitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "AdminUserInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUserInvitation_tokenHash_key" ON "AdminUserInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminUserInvitation_adminUserId_idx" ON "AdminUserInvitation"("adminUserId");

-- CreateIndex
CREATE INDEX "AdminUserInvitation_expiresAt_idx" ON "AdminUserInvitation"("expiresAt");

-- AddForeignKey
ALTER TABLE "AdminUserInvitation" ADD CONSTRAINT "AdminUserInvitation_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
