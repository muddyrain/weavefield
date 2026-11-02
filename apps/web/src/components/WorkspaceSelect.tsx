import { useEffect, useRef, useState } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Skeleton } from './ui/skeleton';

export function WorkspaceSelect({ options, value, defaultValue = '', onValueChange, name, disabled, loading = false, placeholder = '请选择', 'aria-label': label }: {
  options: readonly { value: string; label: string }[]; value?: string; defaultValue?: string;
  onValueChange?: (value: string) => void; name?: string; disabled?: boolean; loading?: boolean; placeholder?: string; 'aria-label': string;
}) {
  const [local, setLocal] = useState(defaultValue), trigger = useRef<HTMLButtonElement>(null);
  const selected = value ?? local;
  useEffect(() => {
    const form = trigger.current?.form;
    // Radix 的隐藏表单字段保留 name/value；重置时也同步可见选择。
    const reset = () => { if (value === undefined) setLocal(defaultValue); };
    form?.addEventListener('reset', reset); return () => form?.removeEventListener('reset', reset);
  }, [defaultValue, value]);
  return <Select name={name} value={selected} disabled={disabled || !options.length} onValueChange={next => { setLocal(next); onValueChange?.(next); }}>
    <SelectTrigger ref={trigger} aria-label={label} aria-busy={loading} title={options.find(option => option.value === selected)?.label}>
      {loading ? <Skeleton className="select-skeleton" aria-hidden="true"/> : <SelectValue placeholder={placeholder}/>}
    </SelectTrigger>
    <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} title={option.label}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}
