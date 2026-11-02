// Adapted from shadcn/ui radix-nova Select (MIT), using the project's individual Radix package and tokens.
import * as SelectPrimitive from '@radix-ui/react-select';
import type { ComponentProps } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;
export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" className={cn('wf-select-trigger', className)} {...props}>
    {children}<SelectPrimitive.Icon asChild><ChevronDown aria-hidden="true"/></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}
export function SelectContent({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content data-slot="select-content" className={cn('wf-ui wf-select-content', className)} position="popper" sideOffset={5} collisionPadding={12} {...props}>
    <SelectPrimitive.ScrollUpButton className="wf-select-scroll"><ChevronUp aria-hidden="true"/></SelectPrimitive.ScrollUpButton>
    <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
    <SelectPrimitive.ScrollDownButton className="wf-select-scroll"><ChevronDown aria-hidden="true"/></SelectPrimitive.ScrollDownButton>
  </SelectPrimitive.Content></SelectPrimitive.Portal>;
}
export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item data-slot="select-item" data-value={props.value} className={cn('wf-select-item', className)} {...props}>
    <SelectPrimitive.ItemText><span className="truncate">{children}</span></SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator><Check aria-hidden="true"/></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>;
}
