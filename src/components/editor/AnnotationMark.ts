import { Mark, mergeAttributes } from "@tiptap/core";

export interface AnnotationMarkAttributes {
  annotationId: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    annotationMark: {
      setAnnotationMark: (attributes: AnnotationMarkAttributes) => ReturnType;
      unsetAnnotationMark: () => ReturnType;
    };
  }
}

export const AnnotationMark = Mark.create<AnnotationMarkAttributes>({
  name: "annotationMark",

  keepOnSplit: false,

  addAttributes() {
    return {
      annotationId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-annotation-id"),
        renderHTML: (attributes) => {
          if (!attributes.annotationId) {
            return {};
          }
          return {
            "data-annotation-id": attributes.annotationId,
            class: "annotation-highlight bg-amber-500/20 underline decoration-amber-500/50 cursor-pointer",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark[data-annotation-id]",
      },
      {
        tag: "span[data-annotation-id]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setAnnotationMark:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      unsetAnnotationMark:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },
});
