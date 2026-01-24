import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import { StatsCard } from "~/entrypoints/popup/components/StatsCard";

describe("StatsCard", () => {
  it("should render label and value", () => {
    render(<StatsCard label="Test Label" value="42" />);

    expect(screen.getByText("Test Label")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("should apply custom className to value", () => {
    const { container } = render(
      <StatsCard label="Blocked" value="1234" className="highlight" />,
    );

    const valueElement = container.querySelector(".value");
    expect(valueElement?.classList.contains("highlight")).toBe(true);
  });

  it("should render without custom className", () => {
    const { container } = render(<StatsCard label="Total" value="5000" />);

    const valueElement = container.querySelector(".value");
    expect(valueElement).toBeTruthy();
  });

  it("should have correct structure", () => {
    const { container } = render(<StatsCard label="Queries" value="100" />);

    const card = container.querySelector(".stat-card");
    const label = container.querySelector(".label");
    const value = container.querySelector(".value");

    expect(card).toBeTruthy();
    expect(label).toBeTruthy();
    expect(value).toBeTruthy();
  });

  it("should handle large numbers as strings", () => {
    render(<StatsCard label="Total Queries" value="1.5M" />);

    expect(screen.getByText("1.5M")).toBeTruthy();
  });

  it("should handle percentage values", () => {
    render(<StatsCard label="Blocked %" value="23.5%" />);

    expect(screen.getByText("23.5%")).toBeTruthy();
  });
});
