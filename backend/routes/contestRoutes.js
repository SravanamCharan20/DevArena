import express from "express";
import mongoose from "mongoose";
import Contest from "../models/Contest.js";
import ContestRoom from "../models/ContestRoom.js";
import Problem from "../models/Problem.js";
import Submission from "../models/Submission.js";
import { authorizeRoles, requireAuth } from "../middlewares/auth.js";
import {
  finalizeContestRoomResults,
  resolveRoomStandings,
} from "../services/contest/results.js";

const ACTIVE_ROOM_STATUSES = ["lobby", "running"];
const ACTIVE_PARTICIPANT_STATES = ["active", "disconnected"];

const contestRouter = express.Router();

const normalizeRoomCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

const parseDuration = (value) => {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return 90;
  return Math.max(5, Math.min(720, Math.floor(duration)));
};

const toMillis = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const isActiveRoomStatus = (status) => ACTIVE_ROOM_STATUSES.includes(status);

const normalizeBoolean = (value) => value === true;

const toStandingsMember = (standing = {}) => ({
  rank: Number.isFinite(Number(standing.rank)) ? Number(standing.rank) : null,
  userId: String(standing.userId || ""),
  username: String(standing.username || ""),
  state: String(standing.state || "active"),
  ready: normalizeBoolean(standing.ready),
  score: Number.isFinite(Number(standing.score)) ? Number(standing.score) : 0,
  penalty: Number.isFinite(Number(standing.penalty)) ? Number(standing.penalty) : 0,
  solvedCount: Number.isFinite(Number(standing.solvedCount))
    ? Number(standing.solvedCount)
    : 0,
  solvedProblemIds: Array.isArray(standing.solvedProblemIds)
    ? standing.solvedProblemIds.map((item) => String(item))
    : [],
  joinedAt: Number.isFinite(Number(standing.joinedAt))
    ? Number(standing.joinedAt)
    : toMillis(standing.joinedAt),
  lastSeenAt: Number.isFinite(Number(standing.lastSeenAt))
    ? Number(standing.lastSeenAt)
    : toMillis(standing.lastSeenAt),
});

const acceptedVerdictExpression = {
  $and: [
    { $eq: ["$status", "done"] },
    { $eq: ["$verdict", "Accepted"] },
    { $gt: ["$testcasesTotal", 0] },
    { $eq: ["$testcasesPassed", "$testcasesTotal"] },
  ],
};

const getAuthorizedRoomForUser = async ({
  roomCode,
  userId,
  select = "_id roomCode contestId status hostUserId hostName participants",
}) => {
  return ContestRoom.findOne({
    roomCode,
    $or: [{ hostUserId: userId }, { participants: { $elemMatch: { userId } } }],
  })
    .select(select)
    .lean();
};

const syncContestActiveStateByRoom = async ({
  contestId,
  roomStatus,
  currentContestIsActive,
}) => {
  if (!contestId) return isActiveRoomStatus(roomStatus);

  const expectedIsActive = isActiveRoomStatus(roomStatus);
  if (
    typeof currentContestIsActive === "boolean" &&
    currentContestIsActive === expectedIsActive
  ) {
    return expectedIsActive;
  }

  await Contest.updateOne(
    { _id: contestId, isActive: { $ne: expectedIsActive } },
    { $set: { isActive: expectedIsActive } }
  );
  return expectedIsActive;
};

const reconcileExpiredRunningRoom = async (room) => {
  if (!room || room.status !== "running") return room;

  const contestEndAtMs = toMillis(room.contestEndAt);
  if (typeof contestEndAtMs !== "number") {
    return room;
  }

  if (contestEndAtMs > Date.now()) {
    return room;
  }

  const finalizedEndAt = new Date();
  await ContestRoom.updateOne(
    { _id: room._id, status: "running" },
    {
      $set: {
        status: "ended",
        contestEndAt: finalizedEndAt,
      },
    }
  );

  await finalizeContestRoomResults({
    roomCode: room.roomCode,
  });

  return {
    ...room,
    status: "ended",
    contestEndAt: finalizedEndAt,
  };
};

contestRouter.get("/active", requireAuth, async (req, res) => {
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
});

contestRouter.get("/recent-finished", requireAuth, async (req, res) => {
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
        roomCode: room.roomCode,
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
});

contestRouter.get("/problems", requireAuth, async (_req, res) => {
  try {
    const problems = await Problem.find({ isActive: true })
      .select(
        "title slug description inputFormat outputFormat constraints difficulty tags credit timeLimit memoryLimit exampleTestcases createdBy createdAt"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: problems.length,
      problems,
    });
  } catch (error) {
    console.error("list problems error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

const createProblemHandler = async (req, res) => {
  try {
    const {
      title,
      slug,
      description,
      inputFormat,
      outputFormat,
      constraints,
      difficulty,
      tags,
      credit,
      timeLimit,
      memoryLimit,
      exampleTestcases,
      hiddenTestcases,
    } = req.body;

    if (!title || !description || !difficulty) {
      return res.status(400).json({
        success: false,
        message: "Title, description and difficulty are required",
      });
    }

    const difficultyValue = String(difficulty).trim();
    if (!["Easy", "Medium", "Hard"].includes(difficultyValue)) {
      return res.status(400).json({
        success: false,
        message: "Difficulty must be Easy, Medium, or Hard",
      });
    }

    const baseSlug = slugify(slug || title);
    if (!baseSlug) {
      return res.status(400).json({
        success: false,
        message: "Could not generate slug for this problem",
      });
    }

    let finalSlug = baseSlug;
    let suffix = 2;
    // Ensure slug uniqueness.
    // eslint-disable-next-line no-await-in-loop
    while (await Problem.exists({ slug: finalSlug })) {
      finalSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const safeTags = Array.isArray(tags)
      ? tags
          .map((tag) => String(tag || "").trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];

    const normalizeTests = (tests) =>
      Array.isArray(tests)
        ? tests
            .map((test) => ({
              input: String(test?.input || "").trim(),
              output: String(test?.output || "").trim(),
              explanation: String(test?.explanation || "").trim(),
            }))
            .filter((test) => test.input && test.output)
        : [];

    const problem = await Problem.create({
      title: String(title).trim(),
      slug: finalSlug,
      description: String(description).trim(),
      inputFormat: String(inputFormat || "").trim(),
      outputFormat: String(outputFormat || "").trim(),
      constraints: String(constraints || "").trim(),
      difficulty: difficultyValue,
      tags: safeTags,
      credit: Number.isFinite(Number(credit)) ? Number(credit) : 100,
      timeLimit: Number.isFinite(Number(timeLimit)) ? Number(timeLimit) : 1000,
      memoryLimit: Number.isFinite(Number(memoryLimit)) ? Number(memoryLimit) : 256,
      exampleTestcases: normalizeTests(exampleTestcases),
      hiddenTestcases: normalizeTests(hiddenTestcases),
      createdBy: String(req.user._id),
    });

    return res.status(201).json({
      success: true,
      message: "Problem created successfully",
      problem: {
        _id: problem._id,
        title: problem.title,
        slug: problem.slug,
        description: problem.description,
        inputFormat: problem.inputFormat,
        outputFormat: problem.outputFormat,
        constraints: problem.constraints,
        difficulty: problem.difficulty,
        tags: problem.tags,
        credit: problem.credit,
        timeLimit: problem.timeLimit,
        memoryLimit: problem.memoryLimit,
        exampleTestcases: problem.exampleTestcases,
        createdBy: problem.createdBy,
        createdAt: problem.createdAt,
      },
    });
  } catch (error) {
    console.error("create problem error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

contestRouter.post("/problems", requireAuth, authorizeRoles("admin"), createProblemHandler);
contestRouter.post(
  "/create-problem",
  requireAuth,
  authorizeRoles("admin"),
  createProblemHandler
);

contestRouter.get("/problems/slug/:slug", requireAuth, async (req, res) => {
  try {
    const slug = slugify(req.params.slug);
    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem slug",
      });
    }

    const problem = await Problem.findOne({ slug, isActive: true })
      .select("-hiddenTestcases")
      .lean();

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found",
      });
    }

    return res.status(200).json({
      success: true,
      problem,
    });
  } catch (error) {
    console.error("get problem by slug error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

contestRouter.get("/problems/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem id",
      });
    }

    const problem = await Problem.findById(req.params.id)
      .select("-hiddenTestcases")
      .lean();

    if (!problem || !problem.isActive) {
      return res.status(404).json({
        success: false,
        message: "Problem not found",
      });
    }

    return res.status(200).json({
      success: true,
      problem,
    });
  } catch (error) {
    console.error("get problem by id error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

contestRouter.get("/rooms/:roomCode/contest", requireAuth, async (req, res) => {
  try {
    const roomCode = normalizeRoomCode(req.params.roomCode);
    if (!roomCode) {
      return res.status(400).json({
        success: false,
        message: "Room code is required",
      });
    }

    const userId = String(req.user._id);
    const room = await ContestRoom.findOne({
      roomCode,
      status: { $in: ["lobby", "running", "ended"] },
      $or: [
        { hostUserId: userId },
        {
          participants: {
            $elemMatch: {
              userId,
              state: { $in: ACTIVE_PARTICIPANT_STATES },
            },
          },
        },
      ],
    })
      .select("roomCode contestId status contestStartAt contestEndAt hostUserId hostName")
      .populate({
        path: "contestId",
        select: "title description duration problems createdBy isActive",
        populate: {
          path: "problems",
          model: "Problem",
          select:
            "title slug description inputFormat outputFormat constraints difficulty tags credit timeLimit memoryLimit exampleTestcases",
        },
      })
      .lean();

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const reconciledRoom = await reconcileExpiredRunningRoom(room);

    const contest = reconciledRoom.contestId;
    if (!contest) {
      return res.status(404).json({
        success: false,
        message: "Contest not found for this room",
      });
    }

    const resolvedContestIsActive = await syncContestActiveStateByRoom({
      contestId: contest._id,
      roomStatus: reconciledRoom.status,
      currentContestIsActive: contest.isActive,
    });

    return res.status(200).json({
      success: true,
      room: {
        roomCode: reconciledRoom.roomCode,
        status: reconciledRoom.status,
        hostUserId: reconciledRoom.hostUserId,
        hostName: reconciledRoom.hostName,
        contestStartAt: reconciledRoom.contestStartAt
          ? new Date(reconciledRoom.contestStartAt).getTime()
          : null,
        contestEndAt: reconciledRoom.contestEndAt
          ? new Date(reconciledRoom.contestEndAt).getTime()
          : null,
      },
      contest: {
        _id: contest._id,
        title: contest.title,
        description: contest.description,
        duration: contest.duration,
        createdBy: contest.createdBy,
        isActive: resolvedContestIsActive,
        problems: Array.isArray(contest.problems) ? contest.problems : [],
      },
    });
  } catch (error) {
    console.error("get room contest error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

contestRouter.get("/rooms/:roomCode/leaderboard", requireAuth, async (req, res) => {
  try {
    const roomCode = normalizeRoomCode(req.params.roomCode);
    if (!roomCode) {
      return res.status(400).json({
        success: false,
        message: "Room code is required",
      });
    }

    const userId = String(req.user._id);
    const room = await getAuthorizedRoomForUser({
      roomCode,
      userId,
      select:
        "roomCode contestId status hostUserId hostName contestStartAt participants finalStandings finalizedAt",
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    let resolvedRoom = room;
    const canFinalizeLeaderboard =
      String(room.status || "") === "ended" ||
      (String(room.status || "") === "closed" &&
        Number.isFinite(toMillis(room.contestStartAt)));

    if (
      canFinalizeLeaderboard &&
      (!room.finalizedAt ||
        !Array.isArray(room.finalStandings) ||
        room.finalStandings.length === 0)
    ) {
      await finalizeContestRoomResults({ roomCode });
      const refreshedRoom = await getAuthorizedRoomForUser({
        roomCode,
        userId,
        select:
          "roomCode contestId status hostUserId hostName contestStartAt participants finalStandings finalizedAt",
      });
      if (refreshedRoom) {
        resolvedRoom = refreshedRoom;
      }
    }

    const members = resolveRoomStandings(resolvedRoom).map(toStandingsMember);

    return res.status(200).json({
      success: true,
      room: {
        roomCode: resolvedRoom.roomCode,
        status: resolvedRoom.status,
        hostUserId: resolvedRoom.hostUserId,
        hostName: resolvedRoom.hostName,
        contestId: resolvedRoom.contestId ? String(resolvedRoom.contestId) : null,
        finalizedAt: resolvedRoom.finalizedAt ? toMillis(resolvedRoom.finalizedAt) : null,
      },
      members,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error("get room leaderboard error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

contestRouter.get("/rooms/:roomCode/submissions", requireAuth, async (req, res) => {
  try {
    const roomCode = normalizeRoomCode(req.params.roomCode);
    if (!roomCode) {
      return res.status(400).json({
        success: false,
        message: "Room code is required",
      });
    }

    const userId = String(req.user._id);
    const room = await getAuthorizedRoomForUser({
      roomCode,
      userId,
      select: "roomCode contestId status hostUserId participants.userId",
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const query = {
      roomCode,
      submissionType: "submit",
    };

    const problemId = String(req.query.problemId || "").trim();
    if (problemId) {
      if (!mongoose.Types.ObjectId.isValid(problemId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid problem id",
        });
      }
      query.problemId = problemId;
    }

    if (room.contestId && mongoose.Types.ObjectId.isValid(String(room.contestId))) {
      query.contestId = room.contestId;
    }

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
      : 50;

    const submissions = await Submission.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(
        "requestId userId username problemId verdict status language executionTime memoryUsed testcasesPassed testcasesTotal scoreDelta penaltyDelta createdAt judgedAt"
      )
      .lean();

    const normalizedSubmissions = submissions.map((item) => ({
      _id: String(item._id),
      requestId: String(item.requestId || ""),
      roomCode,
      contestId: item.contestId ? String(item.contestId) : null,
      problemId: item.problemId ? String(item.problemId) : null,
      userId: String(item.userId || ""),
      username: String(item.username || ""),
      verdict: String(item.verdict || "Pending"),
      status: String(item.status || "done"),
      language: String(item.language || ""),
      executionTime: Number.isFinite(Number(item.executionTime))
        ? Number(item.executionTime)
        : null,
      memoryUsed: Number.isFinite(Number(item.memoryUsed)) ? Number(item.memoryUsed) : null,
      testcasesPassed: Number.isFinite(Number(item.testcasesPassed))
        ? Number(item.testcasesPassed)
        : 0,
      testcasesTotal: Number.isFinite(Number(item.testcasesTotal))
        ? Number(item.testcasesTotal)
        : 0,
      scoreDelta: Number.isFinite(Number(item.scoreDelta)) ? Number(item.scoreDelta) : 0,
      penaltyDelta: Number.isFinite(Number(item.penaltyDelta)) ? Number(item.penaltyDelta) : 0,
      createdAt: item.createdAt ? new Date(item.createdAt).getTime() : null,
      judgedAt: item.judgedAt ? new Date(item.judgedAt).getTime() : null,
    }));

    return res.status(200).json({
      success: true,
      room: {
        roomCode: room.roomCode,
        status: room.status,
        contestId: room.contestId ? String(room.contestId) : null,
      },
      count: normalizedSubmissions.length,
      submissions: normalizedSubmissions,
    });
  } catch (error) {
    console.error("get room submissions error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

contestRouter.get("/rooms/:roomCode/results", requireAuth, async (req, res) => {
  try {
    const roomCode = normalizeRoomCode(req.params.roomCode);
    if (!roomCode) {
      return res.status(400).json({
        success: false,
        message: "Room code is required",
      });
    }

    const userId = String(req.user._id);
    const selectFields =
      "_id roomCode contestId status hostUserId hostName contestStartAt contestEndAt participants finalStandings finalizedAt";

    let room = await getAuthorizedRoomForUser({
      roomCode,
      userId,
      select: selectFields,
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const roomStatus = String(room.status || "");
    const contestStarted = Number.isFinite(toMillis(room.contestStartAt));
    const canShowResults =
      roomStatus === "ended" || (roomStatus === "closed" && contestStarted);
    if (!canShowResults) {
      return res.status(409).json({
        success: false,
        code: "CONTEST_NOT_FINISHED",
        message: "Contest is not finished yet",
        room: {
          roomCode: room.roomCode,
          status: roomStatus,
          contestId: room.contestId ? String(room.contestId) : null,
          contestStartAt: toMillis(room.contestStartAt),
          contestEndAt: toMillis(room.contestEndAt),
        },
      });
    }

    const hasFinalSnapshot =
      room.finalizedAt &&
      Array.isArray(room.finalStandings) &&
      room.finalStandings.length > 0;

    if (!hasFinalSnapshot) {
      await finalizeContestRoomResults({ roomCode });
      room = await getAuthorizedRoomForUser({
        roomCode,
        userId,
        select: selectFields,
      });
      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Room not found",
        });
      }
    }

    const standings = resolveRoomStandings(room).map(toStandingsMember);

    let contestProblems = [];
    if (room.contestId && mongoose.Types.ObjectId.isValid(String(room.contestId))) {
      const contestDoc = await Contest.findById(room.contestId)
        .select("problems")
        .lean();
      const contestProblemIds = Array.isArray(contestDoc?.problems)
        ? contestDoc.problems.map((item) => String(item))
        : [];

      if (contestProblemIds.length > 0) {
        const problemDocs = await Problem.find({
          _id: { $in: contestProblemIds },
        })
          .select("_id title slug difficulty")
          .lean();
        const problemById = new Map(
          problemDocs.map((problem) => [String(problem._id), problem])
        );

        contestProblems = contestProblemIds
          .map((problemId) => {
            const problem = problemById.get(problemId);
            if (!problem) return null;
            return {
              _id: problemId,
              title: String(problem.title || ""),
              slug: String(problem.slug || ""),
              difficulty: String(problem.difficulty || ""),
            };
          })
          .filter(Boolean);
      }
    }

    const submissionSummaryRows = await Submission.aggregate([
      {
        $match: {
          roomCode,
          submissionType: "submit",
        },
      },
      {
        $group: {
          _id: "$userId",
          username: { $max: "$username" },
          totalSubmissions: { $sum: 1 },
          acceptedSubmissions: {
            $sum: { $cond: [acceptedVerdictExpression, 1, 0] },
          },
          failedSubmissions: {
            $sum: {
              $cond: [{ $not: [acceptedVerdictExpression] }, 1, 0],
            },
          },
          totalScoreDelta: { $sum: { $ifNull: ["$scoreDelta", 0] } },
          totalPenaltyDelta: { $sum: { $ifNull: ["$penaltyDelta", 0] } },
          lastSubmissionAt: { $max: "$createdAt" },
        },
      },
    ]);

    const perProblemRows = await Submission.aggregate([
      {
        $match: {
          roomCode,
          submissionType: "submit",
        },
      },
      {
        $group: {
          _id: {
            userId: "$userId",
            problemId: "$problemId",
          },
          attempts: { $sum: 1 },
          accepted: {
            $max: {
              $cond: [acceptedVerdictExpression, 1, 0],
            },
          },
        },
      },
    ]);

    const summaryByUserId = new Map(
      submissionSummaryRows.map((row) => [
        String(row._id || ""),
        {
          username: String(row.username || ""),
          totalSubmissions: Number.isFinite(Number(row.totalSubmissions))
            ? Number(row.totalSubmissions)
            : 0,
          acceptedSubmissions: Number.isFinite(Number(row.acceptedSubmissions))
            ? Number(row.acceptedSubmissions)
            : 0,
          failedSubmissions: Number.isFinite(Number(row.failedSubmissions))
            ? Number(row.failedSubmissions)
            : 0,
          totalScoreDelta: Number.isFinite(Number(row.totalScoreDelta))
            ? Number(row.totalScoreDelta)
            : 0,
          totalPenaltyDelta: Number.isFinite(Number(row.totalPenaltyDelta))
            ? Number(row.totalPenaltyDelta)
            : 0,
          lastSubmissionAt: row.lastSubmissionAt ? toMillis(row.lastSubmissionAt) : null,
        },
      ])
    );

    const problemSummaryByUserId = new Map();
    for (const row of perProblemRows) {
      const entryUserId = String(row?._id?.userId || "");
      const entryProblemId = String(row?._id?.problemId || "");
      if (!entryUserId || !entryProblemId) continue;

      if (!problemSummaryByUserId.has(entryUserId)) {
        problemSummaryByUserId.set(entryUserId, []);
      }

      problemSummaryByUserId.get(entryUserId).push({
        problemId: entryProblemId,
        attempts: Number.isFinite(Number(row.attempts)) ? Number(row.attempts) : 0,
        accepted: Number(row.accepted) > 0,
      });
    }

    const submissionSummary = standings.map((standing) => {
      const userSummary = summaryByUserId.get(standing.userId) || null;
      const byProblem = (problemSummaryByUserId.get(standing.userId) || []).sort(
        (a, b) => {
          if (a.accepted !== b.accepted) return Number(b.accepted) - Number(a.accepted);
          if (b.attempts !== a.attempts) return b.attempts - a.attempts;
          return a.problemId.localeCompare(b.problemId);
        }
      );

      return {
        userId: standing.userId,
        username: standing.username || userSummary?.username || "",
        totalSubmissions: userSummary?.totalSubmissions || 0,
        acceptedSubmissions: userSummary?.acceptedSubmissions || 0,
        failedSubmissions: userSummary?.failedSubmissions || 0,
        totalScoreDelta: userSummary?.totalScoreDelta || 0,
        totalPenaltyDelta: userSummary?.totalPenaltyDelta || 0,
        solvedCount: standing.solvedCount,
        lastSubmissionAt: userSummary?.lastSubmissionAt || null,
        byProblem,
      };
    });

    return res.status(200).json({
      success: true,
      room: {
        roomCode: room.roomCode,
        status: room.status,
        contestId: room.contestId ? String(room.contestId) : null,
        hostUserId: room.hostUserId,
        hostName: room.hostName,
        contestStartAt: toMillis(room.contestStartAt),
        contestEndAt: toMillis(room.contestEndAt),
        finalizedAt: toMillis(room.finalizedAt),
      },
      problems: contestProblems,
      standings,
      submissionSummary,
      generatedAt: Date.now(),
    });
  } catch (error) {
    console.error("get room results error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

contestRouter.get("/contests/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid contest id",
      });
    }

    const contest = await Contest.findById(req.params.id)
      .select("title description duration problems createdBy isActive")
      .populate({
        path: "problems",
        model: "Problem",
        select:
          "title slug description inputFormat outputFormat constraints difficulty tags credit timeLimit memoryLimit exampleTestcases",
      })
      .lean();

    if (!contest || !contest.isActive) {
      return res.status(404).json({
        success: false,
        message: "Contest not found",
      });
    }

    return res.status(200).json({
      success: true,
      contest,
    });
  } catch (error) {
    console.error("get contest by id error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

contestRouter.post(
  "/rooms/:roomCode/contest",
  requireAuth,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const roomCode = normalizeRoomCode(req.params.roomCode);
      if (!roomCode) {
        return res.status(400).json({
          success: false,
          message: "Room code is required",
        });
      }

      const { title, description, duration, problemIds } = req.body || {};
      const selectedProblemIds = Array.isArray(problemIds)
        ? Array.from(
            new Set(
              problemIds
                .map((value) => String(value || "").trim())
                .filter((value) => mongoose.Types.ObjectId.isValid(value))
            )
          )
        : [];

      if (selectedProblemIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Select at least one problem",
        });
      }

      const selectedProblems = await Problem.find({
        _id: { $in: selectedProblemIds },
        isActive: true,
      })
        .select("_id")
        .lean();

      if (selectedProblems.length !== selectedProblemIds.length) {
        return res.status(400).json({
          success: false,
          message: "One or more selected problems are invalid",
        });
      }

      const room = await ContestRoom.findOne({ roomCode })
        .select("hostUserId contestId status")
        .lean();
      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Room not found",
        });
      }

      if (room.hostUserId !== String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: "Only host can update room contest",
        });
      }

      if (room.status !== "lobby") {
        return res.status(409).json({
          success: false,
          message: "Contest can be changed only while room is in lobby",
        });
      }

      const previousContestId = room.contestId ? String(room.contestId) : "";

      const contest = await Contest.create({
        title: String(title || "").trim() || `Room ${roomCode} Contest`,
        description: String(description || "").trim(),
        duration: parseDuration(duration),
        problems: selectedProblemIds,
        createdBy: String(req.user._id),
      });

      await ContestRoom.updateOne(
        { roomCode },
        {
          $set: {
            contestId: contest._id,
          },
        }
      );

      await syncContestActiveStateByRoom({
        contestId: contest._id,
        roomStatus: room.status,
        currentContestIsActive: contest.isActive,
      });

      if (previousContestId && previousContestId !== String(contest._id)) {
        await Contest.updateOne(
          { _id: previousContestId, isActive: { $ne: false } },
          { $set: { isActive: false } }
        );
      }

      return res.status(200).json({
        success: true,
        message: "Contest mapped to room",
        contestId: contest._id,
      });
    } catch (error) {
      console.error("map contest to room error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

export default contestRouter;
