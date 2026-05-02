/** Декоративная стрелка вниз справа от поля выбора (комбобокс / native select). */
export function FieldDropdownChevron({ className = '' }: { className?: string }) {
  return (
    <span className={['field-dropdown-chevron', className].filter(Boolean).join(' ')} aria-hidden="true">
      <svg className="field-dropdown-chevron__svg" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 9l6 6 6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
