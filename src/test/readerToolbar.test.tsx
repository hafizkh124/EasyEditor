import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReaderToolbar } from "@/components/shamela/ReaderToolbar";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { APP_LANG_STORAGE_KEY, translate } from "@/lib/i18n";

/**
 * M10 Phase 3 — ReaderToolbar used to render 13 controls unconditionally
 * (~490px), overflowing a 375px viewport (see the plan's Phase 3 §1). Now
 * bookmark/favorite/split/pdf/import collapse into one overflow menu, shown
 * both inline (md+, for parity with the old always-visible layout) and via
 * the menu (below md) — both wired at once since jsdom doesn't evaluate
 * media queries, so this file asserts DOM structure, not viewport-gated
 * visibility.
 */
function renderToolbar(overrides: Partial<React.ComponentProps<typeof ReaderToolbar>> = {}) {
  return render(
    <LanguageProvider>
      <ReaderToolbar
        title="کتاب کا نام"
        currentPage={3}
        pageCount={10}
        canGoBack={true}
        canGoForward={false}
        tocOpen={false}
        onToggleToc={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />
    </LanguageProvider>,
  );
}

describe("ReaderToolbar — mobile overflow menu", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("always shows TOC, page navigation, and close directly", () => {
    renderToolbar();
    expect(screen.getByLabelText("Contents")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
    expect(screen.getByLabelText("Close reader")).toBeInTheDocument();
  });

  it("renders no overflow trigger when no secondary action is wired", () => {
    renderToolbar();
    expect(screen.queryByLabelText("More actions")).not.toBeInTheDocument();
  });

  it("collapses bookmark/favorite/split/pdf/import into one overflow menu", async () => {
    renderToolbar({
      onToggleBookmark: vi.fn(),
      onToggleFavorite: vi.fn(),
      onRequestSplit: vi.fn(),
      onRequestPdf: vi.fn(),
      onRequestImport: vi.fn(),
    });

    const trigger = screen.getByLabelText("More actions");
    expect(trigger).toHaveClass("md:hidden");

    // Radix's DropdownMenuTrigger opens reliably on a keyboard activation in
    // jsdom (no real PointerEvent support there) — same pattern
    // workspaceAppMenu.test.tsx already uses for the same primitive.
    fireEvent.keyDown(trigger, { key: "Enter" });

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Compare side by side")).toBeInTheDocument();
    expect(within(menu).getByText("Open PDF")).toBeInTheDocument();
    expect(within(menu).getByText("Bookmark this page")).toBeInTheDocument();
    expect(within(menu).getByText("Add to favorites")).toBeInTheDocument();
  });

  it("also renders the same actions inline for md+ (desktop parity)", () => {
    renderToolbar({ onRequestSplit: vi.fn(), onRequestPdf: vi.fn() });
    // Two "Compare side by side" buttons: one in the hidden-below-md inline
    // row, one inside the (unopened) dropdown trigger's content — the inline
    // one is what proves desktop's layout is unchanged.
    const splitButtons = screen.getAllByLabelText("Compare side by side");
    expect(splitButtons.length).toBeGreaterThanOrEqual(1);
    expect(splitButtons[0].closest("div")).toHaveClass("md:flex");
  });

  it("flips prev/next chevrons reactively when the language direction changes, without reading document.documentElement directly", () => {
    window.localStorage.setItem(APP_LANG_STORAGE_KEY, "ur");
    const rtlRender = renderToolbar();
    // In RTL, "previous page" (further back in the book) points the chevron
    // the opposite way from LTR — confirmed by comparing the actual SVG
    // markup between an rtl-language render and an ltr-language render.
    // (The a11y label itself is also translated per-language, so it's looked
    // up rather than hardcoded to the English string.)
    const prevButtonRtl = screen.getByLabelText(translate("ur", "reader.previous_page")).innerHTML;
    rtlRender.unmount();

    window.localStorage.setItem(APP_LANG_STORAGE_KEY, "en");
    renderToolbar();
    const prevButtonLtr = screen.getByLabelText(translate("en", "reader.previous_page")).innerHTML;
    expect(prevButtonRtl).not.toBe(prevButtonLtr);
  });
});
