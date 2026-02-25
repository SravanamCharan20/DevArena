import mongoose from "mongoose";
import Problem from "../../models/Problem.js";
import { slugify } from "./helpers.js";

export const listProblems = async (_req, res) => {
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
