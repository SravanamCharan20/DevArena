import assert from "node:assert/strict";
import test from "node:test";
import { validateCodePolicy } from "../services/judge/codePolicy.js";

test("allows safe C++ snippet", () => {
  const result = validateCodePolicy({
    language: "cpp",
    code: `#include <bits/stdc++.h>
using namespace std;
int main(){ long long a,b; cin>>a>>b; cout<<a+b<<"\\n"; }`,
  });
  assert.equal(result.ok, true);
});

test("rejects restricted C++ APIs", () => {
  const result = validateCodePolicy({
    language: "cpp",
    code: `#include <bits/stdc++.h>
#include <fstream>
int main(){ system("ls"); }`,
  });
  assert.equal(result.ok, false);
});

test("rejects restricted Python modules", () => {
  const result = validateCodePolicy({
    language: "python",
    code: `import os
print("hello")`,
  });
  assert.equal(result.ok, false);
});

test("rejects restricted JavaScript APIs", () => {
  const result = validateCodePolicy({
    language: "javascript",
    code: `const fs = require('fs');`,
  });
  assert.equal(result.ok, false);
});
