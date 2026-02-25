import mongoose from "mongoose";
import Problem from "../../models/Problem.js";
import Contest from "../../models/Contest.js";
import Submission from "../../models/Submission.js";
import { slugify } from "./helpers.js";

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

const normalizeTags = (tags) =>
  Array.isArray(tags)
    ? tags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

const sanitizeDifficulty = (difficulty) => {
  const difficultyValue = String(difficulty || "").trim();
  if (!difficultyValue) return null;
  if (!["Easy", "Medium", "Hard"].includes(difficultyValue)) return null;
  return difficultyValue;
};

const serializeProblem = (problem) => ({
  _id: String(problem._id),
  title: String(problem.title || ""),
  slug: String(problem.slug || ""),
  description: String(problem.description || ""),
  inputFormat: String(problem.inputFormat || ""),
  outputFormat: String(problem.outputFormat || ""),
  constraints: String(problem.constraints || ""),
  difficulty: String(problem.difficulty || "Easy"),
  tags: Array.isArray(problem.tags) ? problem.tags : [],
  credit: Number.isFinite(Number(problem.credit)) ? Number(problem.credit) : 100,
  timeLimit: Number.isFinite(Number(problem.timeLimit)) ? Number(problem.timeLimit) : 1000,
  memoryLimit: Number.isFinite(Number(problem.memoryLimit))
    ? Number(problem.memoryLimit)
    : 256,
  exampleTestcases: Array.isArray(problem.exampleTestcases) ? problem.exampleTestcases : [],
  hiddenTestcasesCount: Array.isArray(problem.hiddenTestcases)
    ? problem.hiddenTestcases.length
    : 0,
  isActive: problem.isActive !== false,
  createdBy: String(problem.createdBy || ""),
  createdAt: problem.createdAt || null,
  updatedAt: problem.updatedAt || null,
});

export const listProblems = async (_req, res) => {
  try {
    const includeArchived = String(_req.query.includeArchived || "") === "1";
    const query = includeArchived ? {} : { isActive: true };

    const problems = await Problem.find(query)
      .select(
        "title slug description inputFormat outputFormat constraints difficulty tags credit timeLimit memoryLimit exampleTestcases hiddenTestcases isActive createdBy createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: problems.length,
      problems: problems.map(serializeProblem),
    });
  } catch (error) {
    console.error("list problems error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const createProblem = async (req, res) => {
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

    const difficultyValue = sanitizeDifficulty(difficulty);
    if (!difficultyValue) {
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

    const safeTags = normalizeTags(tags);

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
      problem: serializeProblem(problem),
    });
  } catch (error) {
    console.error("create problem error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const getProblemBySlug = async (req, res) => {
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
};

export const getProblemById = async (req, res) => {
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
};

export const updateProblem = async (req, res) => {
  try {
    const problemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(problemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem id",
      });
    }

    const problem = await Problem.findById(problemId);
    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found",
      });
    }

    const nextTitle =
      typeof req.body.title === "string" ? String(req.body.title).trim() : null;
    if (typeof nextTitle === "string" && !nextTitle) {
      return res.status(400).json({
        success: false,
        message: "Title cannot be empty",
      });
    }

    if (nextTitle) {
      problem.title = nextTitle;
    }

    if (typeof req.body.description === "string") {
      const value = String(req.body.description).trim();
      if (!value) {
        return res.status(400).json({
          success: false,
          message: "Description cannot be empty",
        });
      }
      problem.description = value;
    }

    if (typeof req.body.slug === "string") {
      const normalizedSlug = slugify(req.body.slug);
      if (!normalizedSlug) {
        return res.status(400).json({
          success: false,
          message: "Invalid problem slug",
        });
      }

      if (normalizedSlug !== problem.slug) {
        const existing = await Problem.findOne({
          _id: { $ne: problem._id },
          slug: normalizedSlug,
        })
          .select("_id")
          .lean();
        if (existing) {
          return res.status(409).json({
            success: false,
            message: "Problem slug already exists",
          });
        }
        problem.slug = normalizedSlug;
      }
    }

    if (typeof req.body.inputFormat === "string") {
      problem.inputFormat = String(req.body.inputFormat).trim();
    }

    if (typeof req.body.outputFormat === "string") {
      problem.outputFormat = String(req.body.outputFormat).trim();
    }

    if (typeof req.body.constraints === "string") {
      problem.constraints = String(req.body.constraints).trim();
    }

    if (typeof req.body.difficulty !== "undefined") {
      const difficultyValue = sanitizeDifficulty(req.body.difficulty);
      if (!difficultyValue) {
        return res.status(400).json({
          success: false,
          message: "Difficulty must be Easy, Medium, or Hard",
        });
      }
      problem.difficulty = difficultyValue;
    }

    if (typeof req.body.tags !== "undefined") {
      problem.tags = normalizeTags(req.body.tags);
    }

    if (typeof req.body.credit !== "undefined") {
      const value = Number(req.body.credit);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({
          success: false,
          message: "Credit must be a non-negative number",
        });
      }
      problem.credit = value;
    }

    if (typeof req.body.timeLimit !== "undefined") {
      const value = Number(req.body.timeLimit);
      if (!Number.isFinite(value) || value < 100) {
        return res.status(400).json({
          success: false,
          message: "Time limit must be at least 100 ms",
        });
      }
      problem.timeLimit = Math.floor(value);
    }

    if (typeof req.body.memoryLimit !== "undefined") {
      const value = Number(req.body.memoryLimit);
      if (!Number.isFinite(value) || value < 16) {
        return res.status(400).json({
          success: false,
          message: "Memory limit must be at least 16 MB",
        });
      }
      problem.memoryLimit = Math.floor(value);
    }

    if (typeof req.body.exampleTestcases !== "undefined") {
      problem.exampleTestcases = normalizeTests(req.body.exampleTestcases);
    }

    if (typeof req.body.hiddenTestcases !== "undefined") {
      problem.hiddenTestcases = normalizeTests(req.body.hiddenTestcases);
    }

    if (typeof req.body.isActive === "boolean") {
      problem.isActive = req.body.isActive;
    }

    await problem.save();

    return res.status(200).json({
      success: true,
      message: "Problem updated successfully",
      problem: serializeProblem(problem),
    });
  } catch (error) {
    console.error("update problem error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const archiveProblem = async (req, res) => {
  try {
    const problemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(problemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem id",
      });
    }

    const problem = await Problem.findById(problemId);
    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found",
      });
    }

    if (!problem.isActive) {
      return res.status(200).json({
        success: true,
        message: "Problem is already archived",
        problem: serializeProblem(problem),
      });
    }

    problem.isActive = false;
    await problem.save();

    return res.status(200).json({
      success: true,
      message: "Problem archived successfully",
      problem: serializeProblem(problem),
    });
  } catch (error) {
    console.error("archive problem error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const unarchiveProblem = async (req, res) => {
  try {
    const problemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(problemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem id",
      });
    }

    const problem = await Problem.findById(problemId);
    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found",
      });
    }

    if (problem.isActive) {
      return res.status(200).json({
        success: true,
        message: "Problem is already active",
        problem: serializeProblem(problem),
      });
    }

    problem.isActive = true;
    await problem.save();

    return res.status(200).json({
      success: true,
      message: "Problem restored successfully",
      problem: serializeProblem(problem),
    });
  } catch (error) {
    console.error("unarchive problem error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const deleteProblem = async (req, res) => {
  try {
    const problemId = String(req.params.id || "").trim();
    if (!mongoose.Types.ObjectId.isValid(problemId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid problem id",
      });
    }

    const problem = await Problem.findById(problemId).select("_id").lean();
    if (!problem) {
      return res.status(404).json({
        success: false,
        message: "Problem not found",
      });
    }

    const [usedInContest, hasSubmissions] = await Promise.all([
      Contest.exists({ problems: problemId }),
      Submission.exists({ problemId }),
    ]);

    if (usedInContest || hasSubmissions) {
      return res.status(409).json({
        success: false,
        message:
          "Problem is linked to contest data. Archive it instead of deleting permanently.",
      });
    }

    await Problem.deleteOne({ _id: problemId });

    return res.status(200).json({
      success: true,
      message: "Problem deleted permanently",
    });
  } catch (error) {
    console.error("delete problem error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
