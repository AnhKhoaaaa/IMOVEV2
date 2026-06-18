import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4',
  {
    variants: {
      variant: {
        default: 'bg-blue-50 border-blue-200 text-blue-800',
        destructive: 'bg-red-50 border-red-200 text-red-800',
        warning: 'bg-amber-50 border-amber-200 text-amber-800',
        success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export function Alert({ className, variant, ...props }) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

export function AlertTitle({ className, ...props }) {
  return <h5 className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
}

export function AlertDescription({ className, ...props }) {
  return <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
}
