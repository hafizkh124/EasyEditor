import { readFileSync } from "node:fs";
import path from "node:path";

describe("self-hosted fonts", () => {
  it("keeps remote font stylesheets out of the application entry CSS", () => {
    const css = readFileSync(path.join(process.cwd(), "src", "index.css"), "utf8");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
  });

  it("bundles the eager faces before the main design stylesheet", () => {
    const main = readFileSync(path.join(process.cwd(), "src", "main.tsx"), "utf8");
    expect(main.indexOf('from "./lib/fonts"')).toBeLessThan(main.indexOf('import "./index.css"'));
  });
});
