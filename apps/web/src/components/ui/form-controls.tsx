import * as React from 'react';
import { cn } from '@/lib/utils';

const field =
  'flex w-full rounded-md border border-input bg-transparent text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(field, 'h-9 px-3 py-1', className)} {...props} />,
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(field, 'min-h-[80px] px-3 py-2', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

/** Plain <select> styled like shadcn's Select; the Radix version arrives with the M2 settings work. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(field, 'h-9 bg-background px-3 py-1', className)} {...props} />
  ),
);
NativeSelect.displayName = 'NativeSelect';

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('text-sm font-medium leading-none', className)} {...props} />
);

export const Kbd = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
  <kbd
    className={cn(
      'pointer-events-none inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground',
      className,
    )}
    {...props}
  />
);
