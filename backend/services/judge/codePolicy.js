const POLICY_RULES = {
  cpp: [
    { pattern: /#\s*include\s*<\s*fstream\s*>/i, label: "fstream" },
    { pattern: /\b(ifstream|ofstream|fstream)\b/i, label: "file streams" },
    { pattern: /\bfreopen\s*\(/i, label: "freopen" },
    { pattern: /\bsystem\s*\(/i, label: "system()" },
    { pattern: /\bpopen\s*\(/i, label: "popen()" },
    { pattern: /\bfork\s*\(/i, label: "fork()" },
    { pattern: /\bexecv?p?\w*\s*\(/i, label: "exec()" },
    { pattern: /#\s*include\s*<\s*sys\/socket\.h\s*>/i, label: "raw sockets" },
    { pattern: /#\s*include\s*<\s*unistd\.h\s*>/i, label: "unistd APIs" },
  ],
  python: [
    { pattern: /\bimport\s+os\b/i, label: "os module" },
    { pattern: /\bfrom\s+os\s+import\b/i, label: "os module" },
    { pattern: /\bimport\s+subprocess\b/i, label: "subprocess module" },
    { pattern: /\bfrom\s+subprocess\s+import\b/i, label: "subprocess module" },
    { pattern: /\bimport\s+socket\b/i, label: "socket module" },
    { pattern: /\bfrom\s+socket\s+import\b/i, label: "socket module" },
    { pattern: /\bimport\s+ctypes\b/i, label: "ctypes module" },
    { pattern: /\bopen\s*\(/i, label: "file open()" },
    { pattern: /\beval\s*\(/i, label: "eval()" },
    { pattern: /\bexec\s*\(/i, label: "exec()" },
  ],
  javascript: [
    { pattern: /require\s*\(\s*["']fs["']\s*\)/i, label: "fs module" },
    { pattern: /from\s+["']fs["']/i, label: "fs module" },
    {
      pattern: /require\s*\(\s*["']child_process["']\s*\)/i,
      label: "child_process module",
    },
    { pattern: /from\s+["']child_process["']/i, label: "child_process module" },
    { pattern: /require\s*\(\s*["']net["']\s*\)/i, label: "net module" },
    { pattern: /from\s+["']net["']/i, label: "net module" },
    { pattern: /process\.exit\s*\(/i, label: "process.exit()" },
  ],
};

export const validateCodePolicy = ({ language, code }) => {
  const normalizedLanguage = String(language || "").trim().toLowerCase();
  const source = String(code || "");
  const rules = POLICY_RULES[normalizedLanguage] || [];

  for (const rule of rules) {
    if (!rule.pattern.test(source)) continue;
    return {
      ok: false,
      reason: rule.label,
      message: `Restricted API usage detected (${rule.label}). Remove it and submit again.`,
    };
  }

  return { ok: true };
};
