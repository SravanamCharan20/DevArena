export const registerRoomSocketHandlers = ({
  io,
  redis,
  socket,
  ok,
  fail,
  Contest,
  ContestRoom,
  Problem,
  finalizeContestRoomResults,
  ROOM_TTL_SECONDS,
  CONTEST_COUNTDOWN_MS,
  normalizeRoomCode,
  normalizeProblemIds,
  normalizeContestTitle,
  normalizeContestDescription,
  normalizeContestDuration,
  getSocketName,
  generateRoomCode,
  toMember,
  findUserActiveRoom,
  getRoomMetaOrHydrate,
  endContestRoom,
  getPersistedParticipant,
  upsertContestParticipant,
  syncRoomCacheFromDb,
  roomUserSocketsKey,
  socketRoomsKey,
  emitRoomMembers,
  getRoomMeta,
  deleteRoomState,
  getRoomMembers,
  roomMetaKey,
  roomMembersKey,
  computeAllReady,
  isRoomAuthorized,
  setContestRoomStatus,
  scheduleContestEnd,
  setContestParticipantState,
  clearContestEndTimer,
  refreshRoomTtls,
}) => {
  socket.on("create-room", async (payload = {}, ack) => {
    let roomCode = "";
    let contestId = null;
    try {
      if (socket.data.user?.role !== "admin") {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Only admin can create room"))
          : undefined;
      }

      const userId = socket.data.user.id;
      const alreadyActiveRoom = await findUserActiveRoom(userId);
      if (alreadyActiveRoom) {
        const activeLabel =
          alreadyActiveRoom.status === "running" ? "contest" : "lobby";
        return typeof ack === "function"
          ? ack(
              fail(
                "BAD_STATE",
                `You are already in an active ${activeLabel} (${alreadyActiveRoom.roomCode}). Leave it first.`
              )
            )
          : undefined;
      }

      roomCode = generateRoomCode();
      while (
        (await redis.exists(roomMetaKey(roomCode))) ||
        (await ContestRoom.exists({ roomCode }))
      ) {
        roomCode = generateRoomCode();
      }

      const selectedProblemIds = normalizeProblemIds(payload.problemIds);
      if (selectedProblemIds.length === 0) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Select at least one problem"))
          : undefined;
      }

      const selectedProblems = await Problem.find({
        _id: { $in: selectedProblemIds },
        isActive: true,
      })
        .select("_id")
        .lean();

      if (selectedProblems.length !== selectedProblemIds.length) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "One or more selected problems are invalid"))
          : undefined;
      }

      const contest = await Contest.create({
        title: normalizeContestTitle(payload.contestTitle, roomCode),
        description: normalizeContestDescription(payload.contestDescription),
        problems: selectedProblemIds,
        duration: normalizeContestDuration(payload.duration),
        createdBy: socket.data.user.id,
      });
      contestId = String(contest._id);

      const hostName = getSocketName(socket);
      const hostMember = toMember(socket, false);
      const roomMeta = {
        roomCode,
        contestId,
        hostUserId: socket.data.user.id,
        hostName,
        status: "lobby",
        contestStartAt: null,
        contestEndAt: null,
        createdAt: new Date().toISOString(),
      };

      await ContestRoom.create({
        roomCode,
        contestId,
        hostUserId: roomMeta.hostUserId,
        hostName: roomMeta.hostName,
        status: roomMeta.status,
        contestStartAt: null,
        participants: [
          {
            userId: hostMember.userId,
            username: hostMember.username,
            ready: hostMember.ready,
            score: hostMember.score,
            penalty: hostMember.penalty,
            solvedCount: hostMember.solvedCount,
            solvedProblemIds: [],
            state: "active",
            joinedAt: new Date(),
            lastSeenAt: new Date(),
          },
        ],
      });

      try {
        const synced = await syncRoomCacheFromDb(redis, roomCode);
        if (!synced?.roomMeta) {
          throw new Error("Could not sync room cache");
        }

        const multi = redis.multi();
        multi.sAdd(roomUserSocketsKey(roomCode, hostMember.userId), socket.id);
        multi.expire(
          roomUserSocketsKey(roomCode, hostMember.userId),
          ROOM_TTL_SECONDS
        );
        multi.sAdd(socketRoomsKey(socket.id), roomCode);
        multi.expire(socketRoomsKey(socket.id), ROOM_TTL_SECONDS);
        await multi.exec();
      } catch (redisError) {
        await ContestRoom.deleteOne({ roomCode });
        throw redisError;
      }

      socket.join(roomCode);
      const freshMeta = await getRoomMeta(redis, roomCode);
      const { members, allReady } = await emitRoomMembers(io, redis, roomCode);

      return typeof ack === "function"
        ? ack(
            ok({
              roomCode,
              contestId: freshMeta?.contestId || roomMeta.contestId,
              contestTitle: contest.title,
              hostName: freshMeta?.hostName || hostName,
              hostUserId: freshMeta?.hostUserId || roomMeta.hostUserId,
              status: freshMeta?.status || roomMeta.status,
              contestStartAt: freshMeta?.contestStartAt || roomMeta.contestStartAt,
              contestEndAt: freshMeta?.contestEndAt || roomMeta.contestEndAt,
              members,
              allReady,
              problemCount: selectedProblemIds.length,
            })
          )
        : undefined;
    } catch (error) {
      console.error("create-room error:", error.message);
      if (roomCode) {
        const members = await getRoomMembers(redis, roomCode);
        if (members.length > 0) {
          await deleteRoomState(redis, roomCode, members);
        } else {
          await redis.del(roomMetaKey(roomCode), roomMembersKey(roomCode));
        }
      }
      if (contestId) {
        await Contest.findByIdAndDelete(contestId);
      }

      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not create room"))
        : undefined;
    }
  });

  socket.on("join-room", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
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

      const userId = socket.data.user.id;
      const alreadyActiveRoom = await findUserActiveRoom(userId, roomCode);
      if (alreadyActiveRoom) {
        const activeLabel =
          alreadyActiveRoom.status === "running" ? "contest" : "lobby";
        return typeof ack === "function"
          ? ack(
              fail(
                "BAD_STATE",
                `You are already in an active ${activeLabel} (${alreadyActiveRoom.roomCode}). Leave it first.`
              )
            )
          : undefined;
      }

      const roomDoc = await ContestRoom.findOne({ roomCode })
        .select("participants")
        .lean();
      const persistedParticipant = getPersistedParticipant(roomDoc, userId);
      const isHost = roomMeta.hostUserId === userId;

      if (roomMeta.status === "running" && !persistedParticipant && !isHost) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Contest already started"))
          : undefined;
      }

      const readyFromDb = persistedParticipant
        ? persistedParticipant.ready === true
        : false;

      await upsertContestParticipant({
        roomCode,
        roomMeta,
        userId,
        username: socket.data.user.username,
        ready: readyFromDb,
        state: "active",
      });

      const synced = await syncRoomCacheFromDb(redis, roomCode);
      if (!synced?.roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      const multi = redis.multi();
      multi.sAdd(roomUserSocketsKey(roomCode, userId), socket.id);
      multi.expire(roomUserSocketsKey(roomCode, userId), ROOM_TTL_SECONDS);
      multi.sAdd(socketRoomsKey(socket.id), roomCode);
      multi.expire(socketRoomsKey(socket.id), ROOM_TTL_SECONDS);
      await multi.exec();

      socket.join(roomCode);
      const { members, allReady } = await emitRoomMembers(io, redis, roomCode);
      const syncedMeta = synced.roomMeta;

      if (
        syncedMeta.status === "running" &&
        typeof syncedMeta.contestEndAt === "number"
      ) {
        scheduleContestEnd({
          io,
          redis,
          roomCode,
          contestEndAt: syncedMeta.contestEndAt,
        });
      }

      return typeof ack === "function"
        ? ack(
            ok({
              roomCode,
              contestId: syncedMeta.contestId || null,
              hostName: syncedMeta.hostName,
              hostUserId: syncedMeta.hostUserId,
              status: syncedMeta.status,
              contestStartAt: syncedMeta.contestStartAt || null,
              contestEndAt: syncedMeta.contestEndAt || null,
              members,
              allReady,
            })
          )
        : undefined;
    } catch (error) {
      console.error("join-room error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not join room"))
        : undefined;
    }
  });

  socket.on("get-room-members", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      const members = await getRoomMembers(redis, roomCode);
      const requesterId = socket.data.user.id;

      if (!isRoomAuthorized(roomMeta, members, requesterId)) {
        const roomDoc = await ContestRoom.findOne({ roomCode })
          .select("hostUserId participants")
          .lean();

        const persistedParticipant = getPersistedParticipant(roomDoc, requesterId);
        const isHost = roomDoc?.hostUserId === requesterId;

        if (!persistedParticipant && !isHost) {
          return typeof ack === "function"
            ? ack(fail("FORBIDDEN", "Not in room"))
            : undefined;
        }
      }

      return typeof ack === "function"
        ? ack(
            ok({
              roomCode,
              contestId: roomMeta.contestId || null,
              hostName: roomMeta.hostName,
              hostUserId: roomMeta.hostUserId,
              status: roomMeta.status,
              contestStartAt: roomMeta.contestStartAt || null,
              contestEndAt: roomMeta.contestEndAt || null,
              members,
              allReady: computeAllReady(members),
            })
          )
        : undefined;
    } catch (error) {
      console.error("get-room-members error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not load members"))
        : undefined;
    }
  });

  socket.on("set-ready", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      if (roomMeta.status !== "lobby") {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest already started"))
          : undefined;
      }

      const userId = socket.data.user.id;
      const memberRaw = await redis.hGet(roomMembersKey(roomCode), userId);
      if (!memberRaw) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Not in room"))
          : undefined;
      }

      const member = JSON.parse(memberRaw);
      const nextReady =
        typeof payload.ready === "boolean" ? payload.ready : !member.ready;

      await upsertContestParticipant({
        roomCode,
        roomMeta,
        userId,
        username: socket.data.user.username,
        ready: nextReady,
        state: "active",
      });

      await syncRoomCacheFromDb(redis, roomCode);
      const { members, allReady } = await emitRoomMembers(io, redis, roomCode);
      return typeof ack === "function"
        ? ack(ok({ roomCode, members, allReady }))
        : undefined;
    } catch (error) {
      console.error("set-ready error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not update ready state"))
        : undefined;
    }
  });

  socket.on("start-contest", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      if (roomMeta.hostUserId !== socket.data.user.id) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Only host can start contest"))
          : undefined;
      }

      if (roomMeta.status !== "lobby") {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest already started"))
          : undefined;
      }

      const members = await getRoomMembers(redis, roomCode);
      const allReady = computeAllReady(members);
      if (!allReady) {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "All members must be ready"))
          : undefined;
      }

      const roomDoc = await ContestRoom.findOne({ roomCode })
        .select("contestId")
        .lean();
      if (!roomDoc?.contestId) {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest is not mapped to this room"))
          : undefined;
      }

      const contestDoc = await Contest.findById(roomDoc.contestId)
        .select("duration")
        .lean();
      const durationMinutes = Number.isFinite(Number(contestDoc?.duration))
        ? Math.max(5, Math.floor(Number(contestDoc.duration)))
        : 90;

      const contestStartAt = Date.now() + CONTEST_COUNTDOWN_MS;
      const contestEndAt = contestStartAt + durationMinutes * 60 * 1000;
      await setContestRoomStatus({
        roomCode,
        status: "running",
        contestStartAt,
        contestEndAt,
      });
      await syncRoomCacheFromDb(redis, roomCode);
      scheduleContestEnd({
        io,
        redis,
        roomCode,
        contestEndAt,
      });

      io.to(roomCode).emit("contest-starting", {
        roomCode,
        contestStartAt,
        contestEndAt,
        durationMinutes,
      });

      return typeof ack === "function"
        ? ack(
            ok({
              roomCode,
              contestStartAt,
              contestEndAt,
              durationMinutes,
              status: "running",
            })
          )
        : undefined;
    } catch (error) {
      console.error("start-contest error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not start contest"))
        : undefined;
    }
  });

  socket.on("end-contest", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      if (roomMeta.hostUserId !== socket.data.user.id) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Only host can end contest"))
          : undefined;
      }

      if (roomMeta.status !== "running") {
        return typeof ack === "function"
          ? ack(fail("BAD_STATE", "Contest is not running"))
          : undefined;
      }

      await endContestRoom({
        io,
        redis,
        roomCode,
        message: "Contest ended by host",
      });

      return typeof ack === "function"
        ? ack(ok({ roomCode, status: "ended" }))
        : undefined;
    } catch (error) {
      console.error("end-contest error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not end contest"))
        : undefined;
    }
  });

  socket.on("leave-room", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      const userId = socket.data.user.id;
      await setContestParticipantState({
        roomCode,
        userId,
        state: "left",
        ready: false,
      });

      const userSocketKey = roomUserSocketsKey(roomCode, userId);
      const socketIds = await redis.sMembers(userSocketKey);

      const multi = redis.multi();
      for (const socketId of socketIds) {
        multi.sRem(socketRoomsKey(socketId), roomCode);
        io.in(socketId).socketsLeave(roomCode);
      }
      multi.del(userSocketKey);
      multi.sRem(socketRoomsKey(socket.id), roomCode);
      await multi.exec();

      socket.leave(roomCode);
      await syncRoomCacheFromDb(redis, roomCode);

      const { members, allReady } = await emitRoomMembers(io, redis, roomCode);
      await refreshRoomTtls(redis, roomCode, members.length > 0);

      return typeof ack === "function"
        ? ack(ok({ roomCode, members, allReady }))
        : undefined;
    } catch (error) {
      console.error("leave-room error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not leave room"))
        : undefined;
    }
  });

  socket.on("close-room", async (payload = {}, ack) => {
    try {
      const roomCode = normalizeRoomCode(payload.roomCode || payload.roomId);
      if (!roomCode) {
        return typeof ack === "function"
          ? ack(fail("BAD_REQUEST", "Room code is required"))
          : undefined;
      }

      const roomMeta = await getRoomMetaOrHydrate(redis, roomCode);
      if (!roomMeta) {
        return typeof ack === "function"
          ? ack(fail("NOT_FOUND", "Room not found"))
          : undefined;
      }

      if (roomMeta.hostUserId !== socket.data.user.id) {
        return typeof ack === "function"
          ? ack(fail("FORBIDDEN", "Only host can close room"))
          : undefined;
      }

      const closedRoom = await setContestRoomStatus({
        roomCode,
        status: "closed",
      });
      const hadStartedContest =
        roomMeta.status === "running" ||
        typeof roomMeta.contestStartAt === "number";
      if (hadStartedContest) {
        await finalizeContestRoomResults({
          roomCode,
          roomDoc: closedRoom,
        });
      }
      clearContestEndTimer(roomCode);

      const members = await getRoomMembers(redis, roomCode);
      io.to(roomCode).emit("room-closed", {
        roomCode,
        message: "Room closed by host",
        resultsReady:
          roomMeta.status === "running" ||
          typeof roomMeta.contestStartAt === "number",
        resultsPath: `/results?room=${roomCode}`,
      });
      io.in(roomCode).socketsLeave(roomCode);

      await deleteRoomState(redis, roomCode, members);
      await syncRoomCacheFromDb(redis, roomCode);

      return typeof ack === "function" ? ack(ok({ roomCode })) : undefined;
    } catch (error) {
      console.error("close-room error:", error.message);
      return typeof ack === "function"
        ? ack(fail("INTERNAL_ERROR", "Could not close room"))
        : undefined;
    }
  });

  socket.on("disconnect", async (reason) => {
    try {
      const socketName = getSocketName(socket);
      const userId = socket.data?.user?.id;
      if (!userId) {
        console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
        return;
      }

      const roomCodes = await redis.sMembers(socketRoomsKey(socket.id));

      for (const roomCode of roomCodes) {
        const userSocketKey = roomUserSocketsKey(roomCode, userId);
        await redis.sRem(userSocketKey, socket.id);

        const remainingSockets = await redis.sCard(userSocketKey);
        if (remainingSockets === 0) {
          await setContestParticipantState({
            roomCode,
            userId,
            state: "disconnected",
          });

          await redis.del(userSocketKey);
        } else {
          await redis.expire(userSocketKey, ROOM_TTL_SECONDS);
        }

        const synced = await syncRoomCacheFromDb(redis, roomCode);
        if (!synced?.roomMeta) continue;

        const { members } = await emitRoomMembers(io, redis, roomCode);
        await refreshRoomTtls(redis, roomCode, members.length > 0);
      }

      await redis.del(socketRoomsKey(socket.id));
      console.log(`[socket:disconnect] ${socketName} (${socket.id}) ${reason}`);
    } catch (error) {
      console.error("disconnect cleanup error:", error.message);
    }
  });
};
