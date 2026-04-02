import React, { useEffect, useRef, useState } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder }: SearchBarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return (): void => { document.removeEventListener('keydown', handleKeyDown); };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(localValue), 300);
    return (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localValue, onChange]);

  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-16 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-gray-500"
        placeholder={placeholder ?? 'Search prompts, responses, errors across all traces...'}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-600 bg-gray-700 px-1.5 py-0.5 rounded">
        ⌘K
      </kbd>
    </div>
  );
}
