import "@tiptap/core";

// The `tiptap-track-changes` package implements these commands at runtime but
// does not augment Tiptap's Commands interface in its type declarations.
// Declare them here so the editor commands are type-checked correctly.
declare module "@tiptap/core" {
  interface ChangeAuthorConfig {
    id: string;
    name: string;
    color: string;
  }

  interface Commands<ReturnType> {
    trackChanges: {
      setTrackChangesAuthor: (author: ChangeAuthorConfig) => ReturnType;
      setTrackChangesMode: (mode: "edit" | "suggest" | "view") => ReturnType;
      acceptAll: () => ReturnType;
      rejectAll: () => ReturnType;
      acceptChange: (changeId: string) => ReturnType;
      rejectChange: (changeId: string) => ReturnType;
    };
  }
}
