import mongoose from "mongoose";
import Contest from "../../models/Contest.js";
import ContestRoom from "../../models/ContestRoom.js";
import {
  finalizeContestRoomResults,
  resolveRoomStandings,
} from "../../services/contest/results.js";
import {
  ACTIVE_PARTICIPANT_STATES,
  ACTIVE_ROOM_STATUSES,
  isActiveRoomStatus,
  normalizeRoomCode,
  syncContestActiveStateByRoom,
  toMillis,
  toStandingsMember,
  reconcileExpiredRunningRoom,
} from "./helpers.js";

export const getActiveContest = async (req, res) => {
  try {
    const userId = String(req.user._id);

    const activeRoom = await ContestRoom.findOne({
      status: { $in: ACTIVE_ROOM_STATUSES },
      $or: [
        {
          participants: {
            $elemMatch: {
              userId,
              state: { $in: ACTIVE_PARTICIPANT_STATES },
            },
          },
        },
        {
          hostUserId: userId,
          participants: {
            $not: {
              $elemMatch: {
                userId,
                state: "left",
              },
            },
          },
        },
      ],
    })
      .sort({ updatedAt: -1 })
      .select(
        "_id roomCode contestId status contestStartAt contestEndAt hostUserId hostName"
      )
      .lean();

    if (!activeRoom) {
      return res.status(200).json({ activeRoom: null });
    }

    const reconciledRoom = await reconcileExpiredRunningRoom(activeRoom);
    await syncContestActiveStateByRoom({
      contestId: reconciledRoom.contestId,
      roomStatus: reconciledRoom.status,
    });

    if (!isActiveRoomStatus(reconciledRoom.status)) {
      return res.status(200).json({ activeRoom: null });
    }

    return res.status(200).json({
      activeRoom: {
        roomCode: reconciledRoom.roomCode,
        contestId: reconciledRoom.contestId ? String(reconciledRoom.contestId) : null,
        status: reconciledRoom.status,
        contestStartAt: reconciledRoom.contestStartAt
          ? new Date(reconciledRoom.contestStartAt).getTime()
          : null,
        contestEndAt: reconciledRoom.contestEndAt
          ? new Date(reconciledRoom.contestEndAt).getTime()
          : null,
        hostUserId: reconciledRoom.hostUserId,
        hostName: reconciledRoom.hostName,
      },
    });
  } catch (error) {
    console.error("active contest error:", error.message);
    return res.status(500).json({
      message: "Could not load active contest",
    });
  }
};

export const getRecentFinishedContests = async (req, res) => {
  try {
    const userId = String(req.user._id);
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(20, Math.floor(rawLimit)))
      : 8;

    const query = {
      status: { $in: ["ended", "closed"] },
      contestStartAt: { $ne: null },
      $or: [
        { hostUserId: userId },
        {
          participants: {
            $elemMatch: {
              userId,
            },
          },
        },
      ],
    };

    const selectFields =
      "_id roomCode contestId status hostUserId hostName contestStartAt contestEndAt finalStandings finalizedAt participants updatedAt";

    let rooms = await ContestRoom.find(query)
      .sort({ finalizedAt: -1, updatedAt: -1 })
      .limit(limit)
      .select(selectFields)
      .lean();

    const needsFinalization = rooms.filter(
      (room) =>
        !room.finalizedAt ||
        !Array.isArray(room.finalStandings) ||
        room.finalStandings.length === 0
    );

    if (needsFinalization.length > 0) {
      for (const room of needsFinalization) {
        // eslint-disable-next-line no-await-in-loop
        await finalizeContestRoomResults({ roomCode: room.roomCode });
      }

      rooms = await ContestRoom.find(query)
        .sort({ finalizedAt: -1, updatedAt: -1 })
        .limit(limit)
        .select(selectFields)
        .lean();
    }

    const contestIds = Array.from(
      new Set(
        rooms
          .map((room) => (room.contestId ? String(room.contestId) : ""))
          .filter((value) => mongoose.Types.ObjectId.isValid(value))
      )
    );

    const contests = await Contest.find({ _id: { $in: contestIds } })
      .select("title duration")
      .lean();
    const contestById = new Map(
      contests.map((contest) => [String(contest._id), contest])
    );

    const entries = rooms.map((room) => {
      const standings = resolveRoomStandings(room).map(toStandingsMember);
      const userStanding =
        standings.find((standing) => standing.userId === userId) || null;
      const contestId = room.contestId ? String(room.contestId) : null;
      const contest = contestId ? contestById.get(contestId) : null;

      return {
        roomCode: normalizeRoomCode(room.roomCode),
        status: room.status,
        hostUserId: room.hostUserId,
        hostName: room.hostName,
        isHost: room.hostUserId === userId,
        contestId,
        contestTitle: contest?.title
          ? String(contest.title)
          : `Room ${room.roomCode} Contest`,
        duration: Number.isFinite(Number(contest?.duration))
          ? Number(contest.duration)
          : null,
        contestStartAt: toMillis(room.contestStartAt),
        contestEndAt: toMillis(room.contestEndAt),
        finalizedAt: toMillis(room.finalizedAt) || toMillis(room.contestEndAt),
        participantCount: standings.length,
        userStanding: userStanding
          ? {
              rank: userStanding.rank,
              score: userStanding.score,
              penalty: userStanding.penalty,
              solvedCount: userStanding.solvedCount,
            }
          : null,
        resultsPath: `/results?room=${room.roomCode}`,
      };
    });

    return res.status(200).json({
      success: true,
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error("recent finished contests error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load recent finished contests",
    });
  }
};
