import * as React from "react";
import { cn } from "../../lib/utils";
import { Input } from "./input";

export interface MinaAmountInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  wrapperClassName?: string;
}

const MinaAmountInput = React.forwardRef<HTMLInputElement, MinaAmountInputProps>(
  ({ className, wrapperClassName, inputMode, step, min, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <Input
        ref={ref}
        type="number"
        inputMode={inputMode ?? "decimal"}
        step={step ?? "any"}
        min={min ?? 0}
        className={cn(
          "pr-16 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className,
        )}
        {...props}
      />
      <span
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
        data-component="mina-amount-suffix"
      >
        MINA
      </span>
    </div>
  ),
);

MinaAmountInput.displayName = "MinaAmountInput";

export { MinaAmountInput };
