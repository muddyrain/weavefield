-- 不合并或删除旧账号；规范化邮箱冲突时整体回滚，交由人工处理。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" GROUP BY lower(btrim("email")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Existing user emails conflict after normalization; migration requires manual review';
  END IF;
END $$;

BEGIN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailCanonical" TEXT,
ADD COLUMN     "passwordHash" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailCanonical_key" ON "User"("emailCanonical");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "User" SET "emailCanonical" = lower(btrim("email"));

COMMIT;
