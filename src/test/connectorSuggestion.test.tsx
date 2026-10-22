import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ConnectorSuggestion } from "@/components/composer/ConnectorSuggestion";

afterEach(cleanup);

describe("ConnectorSuggestion", () => {
  it("offers a switched-off connector the question is about, and enables it only on click", async () => {
    const onEnable = vi.fn(async () => {});
    render(<ConnectorSuggestion text="zakat on 5 tola gold and savings?" isOn={() => false} onEnable={onEnable} />);
    expect(onEnable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(onEnable).toHaveBeenCalledWith("zakat"));
  });

  it("stays out of the way when the connector is already on", () => {
    const { container } = render(
      <ConnectorSuggestion text="zakat on 5 tola gold and savings?" isOn={() => true} onEnable={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not ask again after 'Not now'", async () => {
    const { container } = render(
      <ConnectorSuggestion text="zakat on 5 tola gold and savings?" isOn={() => false} onEnable={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(container).toBeEmptyDOMElement();
  });
});
