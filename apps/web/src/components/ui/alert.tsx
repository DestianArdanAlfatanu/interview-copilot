import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive: 'border-destructive/50 bg-destructive/10 text-destructive',
        warning: 'border-warning/50 bg-warning/10 text-foreground [&>svg]:text-warning',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export const Alert = ({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) => (
  <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
);

export const AlertTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h5 className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
);

export const AlertDescription = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
);
