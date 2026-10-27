import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

// shadcn/ui Button, copied in (MIT) and re-pointed at the project's tokens.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-brand bg-brand text-brand-fg hover:border-brand-dark hover:bg-brand-dark',
        secondary: 'border-line-strong bg-surface text-ink hover:bg-surface-sunken',
        ghost: 'border-transparent bg-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink',
        // A consequential action (archive). Painted with the attention tone so its contrast is
        // already checked in both themes; sits apart from the safe button in the dialog footer.
        destructive: 'border-tone-attention-border bg-tone-attention-bg font-semibold text-tone-attention-fg hover:brightness-95',
      },
      size: {
        default: 'h-9 px-3',
        sm: 'h-8 px-2.5 text-xs',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        // A bare <button> inside a form submits it; default to a plain button.
        type={asChild ? type : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
