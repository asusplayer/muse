-- CreateTable
CREATE TABLE "PlayHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" INTEGER NOT NULL,
    "length" INTEGER NOT NULL,
    "offset" INTEGER NOT NULL,
    "thumbnailUrl" TEXT,
    "isLive" BOOLEAN NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "playedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PlayHistory_guildId_id_idx" ON "PlayHistory"("guildId", "id");

