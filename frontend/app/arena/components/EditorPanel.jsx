import React from "react";

const EditorPanel = ({
  language,
  setLanguage,
  resolvedTheme,
  activeCode,
  onCodeChange,
  MonacoEditor,
  languageToMonaco,
}) => {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow-md)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-base font-semibold text-[var(--text)]">Code Editor</h2>
        <select
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)]"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          <option value="python">Python</option>
          <option value="javascript">JavaScript</option>
          <option value="cpp">C++</option>
        </select>
      </div>

      <div className="h-full min-h-[220px]">
        <MonacoEditor
          height="100%"
          language={languageToMonaco[language]}
          theme={resolvedTheme === "light" ? "vs" : "vs-dark"}
          value={activeCode}
          onChange={(value) => onCodeChange(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineHeight: 22,
            smoothScrolling: true,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
};

export default EditorPanel;
