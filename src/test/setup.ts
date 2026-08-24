// Shared setup for every Vitest file.
//
// Most of this suite does not need a DOM. Files that only exercise pure logic
// carry a `// @vitest-environment node` docblock, which is worth roughly 30s of
// jsdom construction each — so this setup has to survive running with no
// `window` at all. jsdom-specific patching is therefore guarded rather than
// unconditional.
// Registering the matchers is DOM-free — jest-dom only reaches for a document
// when a matcher actually runs, and node-environment files never call one.
import "@testing-library/jest-dom";

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
