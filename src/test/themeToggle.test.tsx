import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { APP_THEME_STORAGE_KEY, applyInitialAppTheme } from "@/lib/theme";

function renderToggle() {
  return render(
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={APP_THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <LanguageProvider>
        <ThemeToggle variant="settings" />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

describe("application theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("applies the saved class before React mounts", () => {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, "dark");
    applyInitialAppTheme();

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("puts the selected theme class on documentElement", async () => {
    renderToggle();

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Dark" })));

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("dark");
  });

  it("offers touch-sized light, dark, and system controls", () => {
    renderToggle();

    const choices = screen.getAllByRole("radio");
    expect(choices).toHaveLength(3);
    for (const choice of choices) expect(choice).toHaveClass("min-h-touch");
  });
});
