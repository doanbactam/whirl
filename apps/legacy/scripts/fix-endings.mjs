// One-off: restore HEAD's per-line endings on lines whose content didn't
// change, so an editor that normalized the whole file doesn't produce a
// phantom whole-file diff. Real hunks (per `git diff --ignore-cr-at-eol`)
// keep whatever endings they have now.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: bun fix-endings.mjs <repo-relative-file>");

const splitKeepEnds = (s) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const headLines = splitKeepEnds(
  execSync(`git show HEAD:${file}`, { encoding: "latin1", maxBuffer: 1 << 26 }),
);
const workLines = splitKeepEnds(readFileSync(file, "latin1"));

const diff = execSync(`git diff -U0 --ignore-cr-at-eol -- ${file}`, {
  encoding: "latin1",
  maxBuffer: 1 << 26,
});
const hunks = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(
  (m) => ({
    oldStart: Number(m[1]),
    oldCount: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newCount: m[4] === undefined ? 1 : Number(m[4]),
  }),
);

const strip = (line) => line.replace(/\r?\n$/, "");
let oldIdx = 0; // 0-based into headLines
let newIdx = 0; // 0-based into workLines
let repaired = 0;

const syncEqualRun = (untilNewIdxExclusive) => {
  while (newIdx < untilNewIdxExclusive) {
    if (strip(headLines[oldIdx]) !== strip(workLines[newIdx])) {
      throw new Error(
        `content mismatch outside hunks at head:${oldIdx + 1} work:${newIdx + 1}`,
      );
    }
    if (headLines[oldIdx] !== workLines[newIdx]) {
      workLines[newIdx] = headLines[oldIdx];
      repaired += 1;
    }
    oldIdx += 1;
    newIdx += 1;
  }
};

for (const hunk of hunks) {
  // A zero-count side anchors AFTER the given line, so the equal run extends
  // through it; a nonzero side starts AT the given line.
  const newBoundary = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
  syncEqualRun(newBoundary);
  oldIdx += hunk.oldCount;
  newIdx += hunk.newCount;
}
syncEqualRun(workLines.length);
if (oldIdx !== headLines.length) {
  throw new Error(`head not fully consumed: ${oldIdx}/${headLines.length}`);
}

writeFileSync(file, workLines.join(""), "latin1");
console.log(`${file}: restored endings on ${repaired} unchanged lines`);
