-- Voice transport metadata for the LiveKit Cloud thin-client architecture.
--
-- The kiosk no longer runs STT/LLM/TTS in production; it joins a LiveKit Cloud room and
-- the cloud voice agent does the processing. These columns let the backend and the admin
-- console correlate a session with its LiveKit room and dispatched agent, and expose
-- live status, without storing any LiveKit secret.

-- AlterTable
ALTER TABLE "interview_sessions"
  ADD COLUMN "voiceTransport"      TEXT NOT NULL DEFAULT 'browser',
  ADD COLUMN "livekitRoomName"     TEXT,
  ADD COLUMN "livekitSessionId"    TEXT,
  ADD COLUMN "voiceAgentSessionId" TEXT,
  ADD COLUMN "voiceConnectedAt"    TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "interview_sessions_livekitRoomName_idx" ON "interview_sessions"("livekitRoomName");
