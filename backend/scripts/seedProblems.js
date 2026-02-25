import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Problem from "../models/Problem.js";

const SEEDED_BY = "system-seed";

const PROBLEMS = [
  {
    title: "A + B",
    slug: "a-plus-b",
    description:
      "Given two integers a and b, print their sum. This is a warm-up problem for testing run and submit flows.",
    inputFormat: "Single line with two space-separated integers a and b.",
    outputFormat: "Print one integer: a + b.",
    constraints: "-10^9 <= a, b <= 10^9",
    difficulty: "Easy",
    tags: ["math", "implementation"],
    credit: 100,
    timeLimit: 1000,
    memoryLimit: 256,
    exampleTestcases: [
      {
        input: "2 3",
        output: "5",
        explanation: "2 + 3 = 5",
      },
      {
        input: "-5 8",
        output: "3",
        explanation: "-5 + 8 = 3",
      },
    ],
    hiddenTestcases: [
      { input: "100 200", output: "300" },
      { input: "-100 -25", output: "-125" },
      { input: "0 0", output: "0" },
      { input: "999999999 1", output: "1000000000" },
    ],
  },
  {
    title: "Sum of N Numbers",
    slug: "sum-of-n-numbers",
    description:
      "Given n and an array of n integers, print the sum of all numbers.",
    inputFormat:
      "First line contains integer n. Second line contains n space-separated integers.",
    outputFormat: "Print one integer: the array sum.",
    constraints: "1 <= n <= 2*10^5, |a[i]| <= 10^9",
    difficulty: "Easy",
    tags: ["array", "math"],
    credit: 120,
    timeLimit: 1200,
    memoryLimit: 256,
    exampleTestcases: [
      {
        input: "5\n1 2 3 4 5",
        output: "15",
      },
    ],
    hiddenTestcases: [
      { input: "1\n5", output: "5" },
      { input: "4\n10 -3 7 2", output: "16" },
      { input: "3\n1000000000 1000000000 1000000000", output: "3000000000" },
    ],
  },
  {
    title: "Maximum Element",
    slug: "maximum-element",
    description:
      "Given n integers, print the maximum value in the array.",
    inputFormat:
      "First line contains integer n. Second line contains n space-separated integers.",
    outputFormat: "Print the maximum integer in the array.",
    constraints: "1 <= n <= 2*10^5, -10^9 <= a[i] <= 10^9",
    difficulty: "Easy",
    tags: ["array"],
    credit: 140,
    timeLimit: 1200,
    memoryLimit: 256,
    exampleTestcases: [
      {
        input: "6\n3 1 8 -2 7 5",
        output: "8",
      },
    ],
    hiddenTestcases: [
      { input: "1\n-10", output: "-10" },
      { input: "5\n9 9 9 9 9", output: "9" },
      { input: "7\n-5 -1 -9 -3 -4 -2 -8", output: "-1" },
    ],
  },
];

const seedProblems = async () => {
  await connectDB();
  console.log("Connected to MongoDB");

  try {
    for (const problem of PROBLEMS) {
      const doc = await Problem.findOneAndUpdate(
        { slug: problem.slug },
        {
          $set: {
            ...problem,
            createdBy: SEEDED_BY,
            isActive: true,
          },
        },
        {
          upsert: true,
          returnDocument: "after",
          setDefaultsOnInsert: true,
        }
      );

      console.log(
        `Seeded: ${doc.title} | slug=${doc.slug} | id=${String(doc._id)}`
      );
    }

    console.log("Problem seeding completed.");
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  }
};

seedProblems().catch(async (error) => {
  console.error("Problem seeding failed:", error.message);
  await mongoose.connection.close();
  process.exit(1);
});
