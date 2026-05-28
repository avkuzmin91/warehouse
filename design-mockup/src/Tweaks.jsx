// === Tweaks panel ===
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "role": "manager"
}/*EDITMODE-END*/;

const Tweaks = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Locked design choices — sidebar layout, default density, indigo accent
  React.useEffect(() => {
    document.documentElement.dataset.concept = 'A';
    document.documentElement.dataset.density = 'default';
  }, []);

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('packmen:role', { detail: t.role }));
  }, [t.role]);

  return (
    <TweaksPanel title="Tweaks · pack-men">
      <TweakSection label="Роль" />
      <TweakSelect
        label="Войти как"
        value={t.role}
        onChange={(v) => setTweak('role', v)}
        options={[
          { value: 'admin', label: 'Администратор' },
          { value: 'manager', label: 'Менеджер' },
          { value: 'warehouse_manager', label: 'Зав. склада' },
          { value: 'user', label: 'Оператор' },
          { value: 'client', label: 'Клиент (Mango)' },
        ]}
      />
    </TweaksPanel>
  );
};

window.Tweaks = Tweaks;
