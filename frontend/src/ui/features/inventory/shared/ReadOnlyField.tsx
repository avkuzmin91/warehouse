export function ReadOnlyField({ label, value, mono, multiline }: { label: string; value: string | null | undefined; mono?: boolean; multiline?: boolean }) {
  return (
    <div>
      <div className="field-label"><span>{label}</span></div>
      <div style={{
        fontSize: 13,
        fontWeight: 500,
        minHeight: 30,
        display: 'flex',
        alignItems: multiline ? 'flex-start' : 'center',
        lineHeight: multiline ? 1.5 : undefined,
        whiteSpace: multiline ? 'pre-wrap' : undefined,
        overflowWrap: multiline ? 'anywhere' : undefined,
      }}>
        <span className={mono ? 'mono' : undefined}>{value || '—'}</span>
      </div>
    </div>
  )
}
