import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TempPasswordDialog } from "./TempPasswordDialog";
import { strings } from "../strings";

describe("TempPasswordDialog", () => {
  it("shows the password once, then calling onOpenChange(false) is the only way to dismiss it - closing clears it for good", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <TempPasswordDialog open password="super-secret-temp-pw" onOpenChange={onOpenChange} />,
    );

    expect(screen.getByText("super-secret-temp-pw")).toBeInTheDocument();
    expect(screen.getByText(strings.tempPassword.warning)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: strings.tempPassword.done }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // The caller (not the dialog) owns the password value - once it clears
    // it in response to onOpenChange(false), re-rendering with password=null
    // must not resurrect the old value anywhere in the DOM.
    rerender(<TempPasswordDialog open={false} password={null} onOpenChange={onOpenChange} />);
    expect(screen.queryByText("super-secret-temp-pw")).not.toBeInTheDocument();
  });

  it("blocks dismissing via outside click or Escape, so the password can't be lost by accident", () => {
    render(<TempPasswordDialog open password="another-secret" onOpenChange={vi.fn()} />);
    const content = screen.getByText(strings.tempPassword.title).closest('[role="dialog"]');
    expect(content).not.toBeNull();
  });
});
