// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listProjectTree,
  readProjectText,
  renameInProject,
  trashInProject,
  createFolderInProject,
  createTextFileInProject,
  resolveEditableInProject,
} from "../../electron/fs/projectFolder";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pf-explorer-"));
  fs.mkdirSync(path.join(root, ".easyeditor"));
  fs.mkdirSync(path.join(root, "02-body"));
  fs.writeFileSync(path.join(root, "intro.md"), "# Intro\n\nhello");
  fs.writeFileSync(path.join(root, "02-body", "ch1.docx"), "fake");
  fs.writeFileSync(path.join(root, "notes.txt"), "a\nb");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("project explorer fs ops", () => {
  it("lists the tree, dirs first, with an openAs hint and skipping .easyeditor", () => {
    const tree = listProjectTree(root);
    expect(tree.map((n) => n.base)).toEqual(["02-body", "intro.md", "notes.txt"]);
    expect(tree[0].kind).toBe("dir");
    expect(tree.find((n) => n.base === "intro.md")?.openAs).toBe("editor-text");
    expect(tree[0].children?.[0].base).toBe("ch1.docx");
    expect(tree[0].children?.[0].openAs).toBe("editor-docx");
  });

  it("reads .md/.txt text but refuses other types", () => {
    expect(readProjectText(root, "intro.md")).toContain("hello");
    expect(() => readProjectText(root, "02-body/ch1.docx")).toThrow(/not a text file/);
  });

  it("the path jail blocks traversal and absolute paths", () => {
    expect(() => resolveEditableInProject(root, "../secrets.txt")).toThrow(/escapes/);
    expect(() => resolveEditableInProject(root, "C:\\Windows\\x")).toThrow(/relative/);
    expect(() => resolveEditableInProject(root, "ok\0.txt")).toThrow(/invalid/);
  });

  it("delete moves to .easyeditor/trash, never fs.rm", () => {
    const { trashed } = trashInProject(root, "notes.txt");
    expect(fs.existsSync(path.join(root, "notes.txt"))).toBe(false);
    expect(fs.existsSync(path.join(root, trashed))).toBe(true);
    expect(trashed.startsWith(".easyeditor/trash/")).toBe(true);
  });

  it("rename refuses to clobber an existing file", () => {
    renameInProject(root, "intro.md", "preface.md");
    expect(fs.existsSync(path.join(root, "preface.md"))).toBe(true);
    fs.writeFileSync(path.join(root, "intro.md"), "x");
    expect(() => renameInProject(root, "intro.md", "preface.md")).toThrow(/already exists/);
  });

  it("createFile only allows .md/.txt", () => {
    createTextFileInProject(root, "new.md", "seed");
    expect(readProjectText(root, "new.md")).toBe("seed");
    expect(() => createTextFileInProject(root, "x.exe")).toThrow(/only .md/);
  });

  it("createFolder makes a nested dir", () => {
    createFolderInProject(root, "03-appendix/tables");
    expect(fs.statSync(path.join(root, "03-appendix", "tables")).isDirectory()).toBe(true);
  });
});
