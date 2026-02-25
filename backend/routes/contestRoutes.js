import express from "express";
import mongoose from "mongoose";
import Contest from "../models/Contest.js";
import ContestRoom from "../models/ContestRoom.js";
import Problem from "../models/Problem.js";
import { authorizeRoles, requireAuth } from "../middlewares/auth.js";

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
