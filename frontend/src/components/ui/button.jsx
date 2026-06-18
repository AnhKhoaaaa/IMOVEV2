import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none',
  {
    variants: {
      variant: {
        default: 'btn-lift shadow-sm hover:shadow-md bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
        outline: 'btn-lift hover:shadow-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900',
        ghost: 'btn-lift text-slate-700 hover:bg-slate-100 hover:text-slate-900',
        destructive: 'btn-lift shadow-sm hover:shadow-md bg-red-500 text-white hover:bg-red-600',
        secondary: 'btn-lift shadow-sm hover:shadow-md bg-slate-100 text-slate-700 hover:bg-slate-200',
        link: 'transition-colors text-blue-600 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-12 rounded-md px-8 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { buttonVariants }
