import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";

// Test component that consumes the language context
function TestConsumer() {
  const { language, direction, setLanguage, t } = useLanguage();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="direction">{direction}</span>
      <span data-testid="translation">{t("nav.home")}</span>
      <button onClick={() => setLanguage("ur")}>Switch to Urdu</button>
      <button onClick={() => setLanguage("en")}>Switch to English</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <LanguageProvider>
      <TestConsumer />
    </LanguageProvider>
  );
}

describe("LanguageContext", () => {
  it("defaults to English language", () => {
    renderWithProvider();
    expect(screen.getByTestId("language").textContent).toBe("en");
  });

  it("defaults to LTR direction for English", () => {
    renderWithProvider();
    expect(screen.getByTestId("direction").textContent).toBe("ltr");
  });

  it("translates a key in English", () => {
    renderWithProvider();
    expect(screen.getByTestId("translation").textContent).toBe("Home");
  });

  it("switches to Urdu and changes direction to RTL", () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("Switch to Urdu"));
    expect(screen.getByTestId("language").textContent).toBe("ur");
    expect(screen.getByTestId("direction").textContent).toBe("rtl");
  });

  it("switches back to English and restores LTR", () => {
    renderWithProvider();
    fireEvent.click(screen.getByText("Switch to Urdu"));
    fireEvent.click(screen.getByText("Switch to English"));
    expect(screen.getByTestId("language").textContent).toBe("en");
    expect(screen.getByTestId("direction").textContent).toBe("ltr");
  });

  it("returns the key itself for unknown translation keys", () => {
    function UnknownKeyConsumer() {
      const { t } = useLanguage();
      return <span data-testid="unknown">{t("non.existent.key")}</span>;
    }
    render(
      <LanguageProvider>
        <UnknownKeyConsumer />
      </LanguageProvider>
    );
    expect(screen.getByTestId("unknown").textContent).toBe("non.existent.key");
  });
});
