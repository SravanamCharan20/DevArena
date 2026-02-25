export const registerJudgeSocketHandlers = ({
  io,
  redis,
  socket,
  ok,
  fail,
  normalizeRoomCode,
  normalizeRunLanguage,
  getRoomMetaOrHydrate,
  endContestRoom,
  getRoomMembers,
  isRoomAuthorized,
  getPersistedParticipant,
  ALLOWED_RUN_LANGUAGES,
  MAX_RUN_CODE_BYTES,
  MAX_RUN_INPUT_BYTES,
  enqueueJudgeJob,
  validateCodePolicy,
  Contest,
  ContestRoom,
  Problem,
  mongoose,
  randomUUID,
}) => {
  socket.on("run-code", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const problemId = String(payload.problemId || payload.problem_id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(problemId)) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Valid problem id is required"))
          : undefined;
      }

      const language = normalizeRunLanguage(payload.language);
      if (!ALLOWED_RUN_LANGUAGES.has(language)) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Unsupported language"))
          : undefined;
      }

      const code = String(payload.code || "");
      if (!code.trim()) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Code cannot be empty"))
          : undefined;
      }

      if (Buffer.byteLength(code, "utf8") > MAX_RUN_CODE_BYTES) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Code payload too large"))
          : undefined;
      }

      const policyCheck = validateCodePolicy({ language, code });
      if (!policyCheck.ok) {
        return typeof ack === "function"
          ? ack(fail("POLICY_VIOLATION", policyCheck.message))
          : undefined;
      }

      const customInput = String(payload.customInput || payload.input || "");
      if (Buffer.byteLength(customInput, "utf8") > MAX_RUN_INPUT_BYTES) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Custom input too large"))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      if (
        roomMeta.status === "running" &&
        typeof roomMeta.contestEndAt === "number" &&
        roomMeta.contestEndAt <= Date.now()
      ) {
        await endContestRoom({
          io,
          redis,
          roomCode,
          message: "Contest time completed",
        });
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest already ended"))
          : undefined;
      }

      if (roomMeta.status !== "running") {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest is not running"))
          : undefined;
      }

      const userId = socket.data.user.id;
      const members = await getRoomMembers(redis, roomCode);
      if (!isRoomAuthorized(roomMeta, members, userId)) {
        const roomDoc = await ContestRoom.findOne({ roomCode })
          .select("hostUserId participants")
          .lean();
        const persistedParticipant = getPersistedParticipant(roomDoc, userId);
        const isHost = roomDoc?.hostUserId === userId;
        if (!persistedParticipant && !isHost) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Not in room"))
            : undefined;
        }
      }

      const contestId = String(roomMeta.contestId || "").trim();
      if (!mongoose.Types.ObjectId.isValid(contestId)) {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Room contest is not available"))
          : undefined;
      }

      const [contestDoc, problemDoc] = await Promise.all([
        Contest.findById(contestId).select("problems").lean(),
        Problem.findById(problemId).select("isActive timeLimit memoryLimit").lean(),
      ]);

      if (!contestDoc) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Contest not found"))
          : undefined;
      }

      if (!problemDoc || !problemDoc.isActive) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Problem not found"))
          : undefined;
      }

      const hasProblemInContest = Array.isArray(contestDoc.problems)
        ? contestDoc.problems.some((item) => String(item) === problemId)
        : false;
      if (!hasProblemInContest) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Problem is not part of this contest"))
          : undefined;
      }

      const baseTimeLimit = Number(problemDoc.timeLimit);
      const timeoutMs = Number.isFinite(baseTimeLimit)
        ? Math.max(1200, Math.min(12000, Math.floor(baseTimeLimit * 3)))
        : 5000;
      const baseMemoryLimit = Number(problemDoc.memoryLimit);
      const memoryLimitMb = Number.isFinite(baseMemoryLimit)
        ? Math.max(64, Math.min(1024, Math.floor(baseMemoryLimit)))
        : 256;
      const requestId = String(payload.requestId || "").trim() || randomUUID();

      const job = await enqueueJudgeJob({
        type: "run",
        requestId,
        roomCode,
        contestId,
        problemId,
        userId,
        username: socket.data.user.username,
        language,
        code,
        customInput,
        timeoutMs,
        memoryLimitMb,
        enqueuedAt: Date.now(),
      });

      return typeof ack === "function"
        ? ack(
            ok({
              requestId,
              jobId: String(job.id),
              queuedAt: Date.now(),
            })
          )
        : undefined;
    } catch (error) {
      console.error("run-code error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not run code"))
        : undefined;
    }
  });

  socket.on("submit-code", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const problemId = String(payload.problemId || payload.problem_id || "").trim();
      if (!mongoose.Types.ObjectId.isValid(problemId)) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Valid problem id is required"))
          : undefined;
      }

      const language = normalizeRunLanguage(payload.language);
      if (!ALLOWED_RUN_LANGUAGES.has(language)) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Unsupported language"))
          : undefined;
      }

      const code = String(payload.code || "");
      if (!code.trim()) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Code cannot be empty"))
          : undefined;
      }

      if (Buffer.byteLength(code, "utf8") > MAX_RUN_CODE_BYTES) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Code payload too large"))
          : undefined;
      }

      const policyCheck = validateCodePolicy({ language, code });
      if (!policyCheck.ok) {
        return typeof ack === "function"
          ? ack(fail("POLICY_VIOLATION", policyCheck.message))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      if (
        roomMeta.status === "running" &&
        typeof roomMeta.contestEndAt === "number" &&
        roomMeta.contestEndAt <= Date.now()
      ) {
        await endContestRoom({
          io,
          redis,
          roomCode,
          message: "Contest time completed",
        });
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest already ended"))
          : undefined;
      }

      if (roomMeta.status !== "running") {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest is not running"))
          : undefined;
      }

      const userId = socket.data.user.id;
      const members = await getRoomMembers(redis, roomCode);
      if (!isRoomAuthorized(roomMeta, members, userId)) {
        const roomDoc = await ContestRoom.findOne({ roomCode })
          .select("hostUserId participants")
          .lean();
        const persistedParticipant = getPersistedParticipant(roomDoc, userId);
        const isHost = roomDoc?.hostUserId === userId;
        if (!persistedParticipant && !isHost) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Not in room"))
            : undefined;
        }
      }

      const contestId = String(roomMeta.contestId || "").trim();
      if (!mongoose.Types.ObjectId.isValid(contestId)) {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Room contest is not available"))
          : undefined;
      }

      const [contestDoc, problemDoc] = await Promise.all([
        Contest.findById(contestId).select("problems").lean(),
        Problem.findById(problemId)
          .select("isActive timeLimit memoryLimit credit hiddenTestcases")
          .lean(),
      ]);

      if (!contestDoc) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Contest not found"))
          : undefined;
      }

      if (!problemDoc || !problemDoc.isActive) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Problem not found"))
          : undefined;
      }

      const hasProblemInContest = Array.isArray(contestDoc.problems)
        ? contestDoc.problems.some((item) => String(item) === problemId)
        : false;
      if (!hasProblemInContest) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Problem is not part of this contest"))
          : undefined;
      }

      const hiddenTestcases = Array.isArray(problemDoc.hiddenTestcases)
        ? problemDoc.hiddenTestcases
        : [];
      if (hiddenTestcases.length === 0) {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "No hidden testcases configured for this problem"))
          : undefined;
      }

      const baseTimeLimit = Number(problemDoc.timeLimit);
      const timeoutMs = Number.isFinite(baseTimeLimit)
        ? Math.max(1200, Math.min(12000, Math.floor(baseTimeLimit * 3)))
        : 5000;
      const baseMemoryLimit = Number(problemDoc.memoryLimit);
      const memoryLimitMb = Number.isFinite(baseMemoryLimit)
        ? Math.max(64, Math.min(1024, Math.floor(baseMemoryLimit)))
        : 256;
      const requestId = String(payload.requestId || "").trim() || randomUUID();

      const job = await enqueueJudgeJob({
        type: "submit",
        requestId,
        roomCode,
        contestId,
        problemId,
        userId,
        username: socket.data.user.username,
        language,
        code,
        customInput: "",
        timeoutMs,
        memoryLimitMb,
        problemCredit: Number.isFinite(Number(problemDoc.credit))
          ? Number(problemDoc.credit)
          : 100,
        judgeTestcases: hiddenTestcases.map((testcase) => ({
          input: String(testcase?.input || ""),
          output: String(testcase?.output || ""),
        })),
        enqueuedAt: Date.now(),
      });

      return typeof ack === "function"
        ? ack(
            ok({
              requestId,
              jobId: String(job.id),
              queuedAt: Date.now(),
            })
          )
        : undefined;
    } catch (error) {
      console.error("submit-code error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not submit code"))
        : undefined;
    }
  });
};
