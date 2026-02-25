import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { MAX_RUN_OUTPUT_BYTES } from "./constants.js";

const LANGUAGE_CONFIG = {
  python: {
    image: "python:3.11-alpine",
    sourceFile: "main.py",
    command: "python3 main.py",
  },
  javascript: {
    image: "node:20-alpine",
    sourceFile: "main.js",
    command: "node main.js",
  },
  cpp: {
    image: "gcc:13",
    sourceFile: "main.cpp",
    command:
      "g++ main.cpp -O2 -std=c++17 -o main 2>compile.err; " +
      'if [ $? -ne 0 ]; then cat compile.err >&2; exit 42; fi; ./main',
  },
};
const preparedImages = new Set();
const imagePreparePromises = new Map();

const limitOutput = (value) => {
  const raw = String(value || "");
  if (Buffer.byteLength(raw, "utf8") <= MAX_RUN_OUTPUT_BYTES) return raw;

  let output = raw;
  while (Buffer.byteLength(output, "utf8") > MAX_RUN_OUTPUT_BYTES) {
    output = output.slice(0, Math.max(0, output.length - 512));
  }
  return `${output}\n[output truncated]`;
};

const runCommand = async (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        stdout: limitOutput(stdout),
        stderr: limitOutput(stderr),
      });
    });
  });

const ensureImageReady = async (image) => {
  if (!image) throw new Error("Missing docker image");
  if (preparedImages.has(image)) return;
  if (imagePreparePromises.has(image)) {
    await imagePreparePromises.get(image);
    return;
  }

  const preparePromise = (async () => {
    const inspect = await runCommand("docker", ["image", "inspect", image]);
    if (inspect.exitCode === 0) {
      preparedImages.add(image);
      return;
    }

    const pull = await runCommand("docker", ["pull", image]);
    if (pull.exitCode !== 0) {
      throw new Error(pull.stderr || pull.stdout || `Failed to pull docker image ${image}`);
    }

    preparedImages.add(image);
  })();

  imagePreparePromises.set(image, preparePromise);
  try {
    await preparePromise;
  } finally {
    imagePreparePromises.delete(image);
  }
};

const killContainer = async (containerName) => {
  try {
    await new Promise((resolve) => {
      const cleanup = spawn("docker", ["rm", "-f", containerName], {
        stdio: "ignore",
      });
      cleanup.on("error", () => resolve());
      cleanup.on("exit", () => resolve());
    });
  } catch {
    // Ignore cleanup failures.
  }
};

const runDockerExecution = async ({
  image,
  workDir,
  command,
  stdin,
  timeoutMs,
  containerName,
}) => {
  return new Promise((resolve) => {
    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--network",
      "none",
      "--cpus",
      "1",
      "--memory",
      "256m",
      "--pids-limit",
      "128",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "-i",
      "-v",
      `${workDir}:/workspace`,
      "-w",
      "/workspace",
      image,
      "sh",
      "-lc",
      command,
    ];

    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const complete = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(async () => {
      timedOut = true;
      child.kill("SIGKILL");
      await killContainer(containerName);
      complete({
        timedOut: true,
        exitCode: null,
        stdout: limitOutput(stdout),
        stderr: limitOutput(stderr),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      stdout = limitOutput(stdout);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      stderr = limitOutput(stderr);
    });

    child.on("error", (error) => {
      complete({
        timedOut,
        exitCode: null,
        stdout: "",
        stderr: `Docker execution error: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      if (timedOut) return;
      complete({
        timedOut: false,
        exitCode: Number.isInteger(code) ? code : null,
        stdout: limitOutput(stdout),
        stderr: limitOutput(stderr),
      });
    });

    if (stdin) {
      child.stdin.write(String(stdin));
    }
    child.stdin.end();
  });
};

export const executeCodeRun = async ({
  language,
  code,
  stdin = "",
  timeoutMs = 5000,
}) => {
  const config = LANGUAGE_CONFIG[language];
  if (!config) {
    return {
      verdict: "Runtime Error",
      stdout: "",
      stderr: `Unsupported language: ${language}`,
      runtimeMs: 0,
      memoryKb: null,
      timedOut: false,
    };
  }

  await ensureImageReady(config.image);

  const startTime = Date.now();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "devarena-run-"));
  const containerName = `devarena-run-${randomUUID().slice(0, 12)}`;

  try {
    await fs.writeFile(path.join(tempRoot, config.sourceFile), code, "utf8");
    await fs.chmod(tempRoot, 0o777);

    const result = await runDockerExecution({
      image: config.image,
      workDir: tempRoot,
      command: config.command,
      stdin,
      timeoutMs,
      containerName,
    });

    const runtimeMs = Date.now() - startTime;

    if (result.timedOut) {
      return {
        verdict: "Time Limit Exceeded",
        stdout: result.stdout,
        stderr: result.stderr || "Execution timed out",
        runtimeMs,
        memoryKb: null,
        timedOut: true,
      };
    }

    if (language === "cpp" && result.exitCode === 42) {
      return {
        verdict: "Compilation Error",
        stdout: result.stdout,
        stderr: result.stderr,
        runtimeMs,
        memoryKb: null,
        timedOut: false,
      };
    }

    if (result.exitCode !== 0) {
      return {
        verdict: "Runtime Error",
        stdout: result.stdout,
        stderr: result.stderr,
        runtimeMs,
        memoryKb: null,
        timedOut: false,
      };
    }

    return {
      verdict: "Accepted",
      stdout: result.stdout,
      stderr: result.stderr,
      runtimeMs,
      memoryKb: null,
      timedOut: false,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};
