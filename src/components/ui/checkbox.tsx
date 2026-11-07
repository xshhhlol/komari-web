import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer group border-[var(--accent-6)] bg-[var(--accent-1)] data-[state=checked]:bg-[var(--accent-8)] data-[state=checked]:text-[var(--accent-12)] data-[state=checked]:border-[var(--accent-9)] focus-visible:border-[var(--accent-10)] focus-visible:ring-[var(--accent-7)]/50 aria-invalid:ring-red-500/20 dark:aria-invalid:ring-red-400/40 aria-invalid:border-red-500 size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        {/* 部分选中（indeterminate）显示横线，与全选的对勾区分开 */}
        <CheckIcon className="size-3.5 group-data-[state=indeterminate]:hidden" />
        <MinusIcon className="size-3.5 hidden group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }