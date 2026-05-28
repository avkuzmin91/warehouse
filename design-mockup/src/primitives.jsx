// === Reusable design primitives ===
const { useState, useEffect, useMemo, useRef } = React;

const Brand = ({ size = 22, color }) => {
  // pack-men pac-shape mark — circle with mouth wedge
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{flex: `0 0 ${s}px`}}>
      <path
        d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 0L12 12l8.2-4.8A9.5 9.5 0 0 0 12 2.5zm0 19L12 12l8.2 4.8A9.5 9.5 0 0 1 12 21.5z"
        fill={color || 'var(--c-accent)'}
        fillRule="evenodd"
      />
    </svg>
  );
};

const BrandWord = () => (
  <span style={{display: 'inline-flex', alignItems: 'baseline', gap: 8}}>
    <Brand size={20} />
    <span style={{fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em'}}>pack-men</span>
  </span>
);

const Badge = ({ tone = '', children, dot = false }) => (
  <span className={`badge ${tone}`}>
    {dot && <span className="dot" />}
    {children}
  </span>
);

const Checkbox = ({ checked, onChange }) => (
  <div
    className={`t-checkbox ${checked ? 'checked' : ''}`}
    onClick={(e) => { e.stopPropagation(); onChange && onChange(!checked); }}
  >
    {checked && <Icon name="check" size={10} />}
  </div>
);

const Sparkline = ({ data, color, height = 32, fill = true }) => {
  const w = 120;
  const h = height;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - v * h]);
  const path = pts.map((p, i) => (i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `L${p[0].toFixed(1)},${p[1].toFixed(1)}`)).join(' ');
  const fillPath = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{width: '100%', height: h, display: 'block'}}>
      {fill && <path d={fillPath} className="spark-fill" style={color ? {fill: color, opacity: 0.1} : undefined}/>}
      <path d={path} className="spark-line" style={color ? {stroke: color} : undefined}/>
    </svg>
  );
};

const KPI = ({ label, value, delta, deltaDir = 'up', spark, unit }) => (
  <div className="kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">
      {value}
      {unit && <span style={{fontSize: 13, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 4}}>{unit}</span>}
    </div>
    {delta && (
      <div className={`kpi-delta ${deltaDir}`}>
        <Icon name={deltaDir === 'up' ? 'arrowUp' : 'arrowDown'} size={12} />
        {delta}
      </div>
    )}
    {spark && <div className="kpi-spark"><Sparkline data={spark}/></div>}
  </div>
);

const Tabs = ({ tabs, active, onChange }) => (
  <div className="tabs">
    {tabs.map(t => (
      <div
        key={t.id || t}
        className={`tab ${(t.id || t) === active ? 'active' : ''}`}
        onClick={() => onChange(t.id || t)}
      >
        {t.label || t}
        {t.count !== undefined && <span style={{marginLeft: 6, color: 'var(--c-text-subtle)', fontFamily: 'var(--font-mono)', fontSize: 11.5}}>{t.count}</span>}
      </div>
    ))}
  </div>
);

const Avatar = ({ initials, lg = false }) => (
  <div className={`avatar ${lg ? 'lg' : ''}`}>{initials}</div>
);

// Empty state
const Empty = ({ title, sub, action }) => (
  <div className="empty">
    <div className="empty-illust"/>
    <div style={{fontSize: 14, fontWeight: 500, color: 'var(--c-text)'}}>{title}</div>
    {sub && <div className="text-sm muted mt-8">{sub}</div>}
    {action && <div className="mt-16">{action}</div>}
  </div>
);

// Status -> badge tone
const statusTone = (status) => ({
  draft: '', in_progress: 'info', verified: 'success', done: 'success', cancelled: 'danger',
  packing: 'info', ready: 'accent', shipped: 'success',
  open: 'warning', reported: 'info', returned: 'success',
  pending: '', in: 'info', reviewed: 'success',
}[status] || '');

const RoleBadge = ({ role }) => (
  <Badge tone={D.roleColors[role] || ''} dot>{D.roleLabels[role] || role}</Badge>
);

// Filter chip with optional value
const FilterChip = ({ label, value, active, onClick }) => (
  <div className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
    {label}
    {value && <span style={{color: active ? 'var(--c-accent-text)' : 'var(--c-text)', fontWeight: 500}}>: {value}</span>}
    {active && <Icon name="x" size={11} className="x"/>}
  </div>
);

// === SideSheet — right-side drawer ===
const SideSheet = ({ open, onClose, title, subtitle, width = 480, footer, children }) => {
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(20,20,15,0.32)',
      display: 'flex', justifyContent: 'flex-end',
      backdropFilter: 'blur(2px)',
    }} onClick={onClose}>
      <div
        style={{
          width, maxWidth: '92vw', height: '100%',
          background: 'var(--c-bg-elev)',
          boxShadow: 'var(--sh-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'sheetIn 220ms cubic-bezier(.2,.7,.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{padding: '16px 20px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'flex-start', gap: 10}}>
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em'}}>{title}</div>
            {subtitle && <div className="text-xs subtle" style={{marginTop: 3}}>{subtitle}</div>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div style={{flex: 1, overflow: 'auto', padding: '18px 20px'}}>{children}</div>
        {footer && (
          <div style={{padding: '12px 20px', borderTop: '1px solid var(--c-border)', display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--c-bg-sunken)'}}>
            {footer}
          </div>
        )}
      </div>
      <style>{`
        @keyframes sheetIn { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </div>
  );
};

// === Form controls ===
const Field = ({ label, help, error, required, children, hint }) => (
  <div className="field">
    <label className="label" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <span>
        {label}
        {required && <span style={{color: 'var(--c-danger)', marginLeft: 3}}>*</span>}
      </span>
      {hint && <span className="text-xs faint">{hint}</span>}
    </label>
    {children}
    {help && !error && <div className="help">{help}</div>}
    {error && <div className="help" style={{color: 'var(--c-danger)'}}>{error}</div>}
  </div>
);

const Toggle = ({ checked, onChange, label }) => (
  <label style={{display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none'}}>
    <div
      onClick={() => onChange && onChange(!checked)}
      style={{
        width: 30, height: 18, borderRadius: 99,
        background: checked ? 'var(--c-accent)' : 'var(--c-border-strong)',
        position: 'relative',
        transition: 'background 120ms',
        flex: '0 0 30px',
      }}
    >
      <div style={{
        position: 'absolute',
        width: 14, height: 14, borderRadius: 50,
        background: 'white', top: 2, left: checked ? 14 : 2,
        transition: 'left 120ms',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      }}/>
    </div>
    {label && <span style={{fontSize: 13}}>{label}</span>}
  </label>
);

const Select = ({ value, onChange, options, placeholder, prefix }) => (
  <div style={{position: 'relative'}}>
    {prefix && <Icon name={prefix} size={14} style={{position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)'}}/>}
    <select
      className="input"
      style={{paddingLeft: prefix ? 32 : 10, appearance: 'none', paddingRight: 30, cursor: 'pointer'}}
      value={value}
      onChange={(e) => onChange && onChange(e.target.value)}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
    <Icon name="chevDown" size={13} style={{position: 'absolute', right: 8, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none'}}/>
  </div>
);

// Number input with stepper
const NumberStep = ({ value, onChange, min = 0, max, step = 1, suffix, width = 110 }) => (
  <div style={{display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 30, width, background: 'var(--c-bg-elev)'}}>
    <button
      className="btn ghost icon sm"
      style={{height: 28, width: 26, border: 0, borderRight: '1px solid var(--c-border)'}}
      onClick={() => onChange && onChange(Math.max(min, value - step))}
    ><Icon name="x" size={11}/></button>
    <input
      style={{flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', background: 'transparent', minWidth: 0, width: '100%'}}
      value={value}
      onChange={(e) => onChange && onChange(Number(e.target.value) || 0)}
    />
    {suffix && <span className="text-xs subtle" style={{padding: '0 6px'}}>{suffix}</span>}
    <button
      className="btn ghost icon sm"
      style={{height: 28, width: 26, border: 0, borderLeft: '1px solid var(--c-border)'}}
      onClick={() => onChange && onChange(max ? Math.min(max, value + step) : value + step)}
    ><Icon name="plus" size={11}/></button>
  </div>
);

window.SideSheet = SideSheet;
window.Field = Field;
window.Toggle = Toggle;
window.Select = Select;
window.NumberStep = NumberStep;

window.Brand = Brand;
window.BrandWord = BrandWord;
window.Badge = Badge;
window.Checkbox = Checkbox;
window.Sparkline = Sparkline;
window.KPI = KPI;
window.Tabs = Tabs;
window.Avatar = Avatar;
window.Empty = Empty;
window.statusTone = statusTone;
window.RoleBadge = RoleBadge;
window.FilterChip = FilterChip;
