<script>
  import Field from '../../parts/Field.svelte';
  import CheckField from '../../parts/CheckField.svelte';
  import { localize } from '../../../i18n.ts';
  import { WEAPON_RANGES } from '../../../rules.ts';

  const WOUND_ROLLS = [
    'Bleeding', 'Bleeding [-]', 'Bleeding [+]',
    'Blunt Force', 'Blunt Force [-]', 'Blunt Force [+]',
    'Fire & Explosives', 'Fire & Explosives [-]', 'Fire & Explosives [+]',
    'Gore & Massive', 'Gore & Massive [-]', 'Gore & Massive [+]',
    'Gunshot', 'Gunshot [-]', 'Gunshot [+]',
  ];

  // Scoped styles below own only the damage-mode rows; `item-armor-grid`/`circle-statwrapper-*`
  // stay in css/mothership.css since Armor.svelte hand-writes them too.

  // `store` is absent in the design gallery, which mounts bodies from a plain system object.
  let { system, store = null } = $props();

  const RANGE_CHOICES = WEAPON_RANGES.map((range) => ({
    value: range,
    label: localize(`Mothership.RangeBand.${range}`),
  }));

  // Rendered from the snapshot (what re-renders); written from the document, so a second edit in
  // the same tick sees what the first one wrote.
  const rows = $derived(system.damageModes ?? []);

  const stored = () => store?.document.system.damageModes ?? rows;

  const save = (next) => store?.document.update({ 'system.damageModes': next });

  const addMode = () => save([...stored(), { label: '', formula: '' }]);

  const removeMode = (index) => save(stored().filter((_, i) => i !== index));

  /**
   * No `name` attribute, so this handler owns the write. stopPropagation keeps the surrounding
   * form from submitting and re-rendering the row mid-edit.
   */
  const edit = (index, field) => (event) => {
    event.stopPropagation();
    const value = event.currentTarget.value;
    save(stored().map((mode, i) => (i === index ? { ...mode, [field]: value } : mode)));
  };
</script>

<div class="item-armor-grid" style="margin-top: 10px; margin-bottom: 10px;">
  <div>
    <div class="circle-statwrapper-horizontal transparentBackground">
      <Field
        name="system.damage"
        label={localize('Mothership.Damage')}
        value={system.damage}
        wrapper="text"
        width="180px"
      />
      <Field
        name="system.critDmg"
        label={localize('Mothership.CriticalDamage')}
        value={system.critDmg}
        wrapper="text"
        width="180px"
      />
    </div>

    <div class="circle-statwrapper-horizontal transparentBackground">
      <CheckField
        name="system.antiArmor"
        label={localize('Mothership.AntiArmor')}
        checked={system.antiArmor}
      />
      <Field
        name="system.range"
        label={localize('Mothership.Range')}
        value={system.range}
        wrapper="text"
        width="180px"
        choices={RANGE_CHOICES}
      />
    </div>

    <div class="circle-statwrapper-horizontal">
      <Field
        name="system.ammoType"
        label={localize('Mothership.AmmoType')}
        value={system.ammoType}
        wrapper="text"
        width="180px"
      />
      <CheckField
        name="system.useAmmo"
        label={localize('Mothership.UsesAmmo')}
        checked={system.useAmmo}
      />
    </div>

    <br />

    <div class="resource">
      <label class="resource-label" for="system.woundEffect">{localize('Mothership.WoundEffect')}</label>
      <input
        id="system.woundEffect"
        type="text"
        list="woundRolls"
        name="system.woundEffect"
        value={system.woundEffect}
        data-dtype="String"
      />
      <datalist id="woundRolls">
        {#each WOUND_ROLLS as roll (roll)}
          <option value={roll}></option>
        {/each}
      </datalist>
    </div>
  </div>

  <div class="circle-statwrapper-vertical" style="gap: 10px;">
    <Field name="system.shots" label={localize('Mothership.MaxShots')} value={system.shots} dtype="Number" />
    <Field
      name="system.curShots"
      label={localize('Mothership.CurrentShots')}
      value={system.curShots}
      dtype="Number"
    />
    <Field
      name="system.shotsPerFire"
      label={localize('Mothership.ShotsPerFiring')}
      value={system.shotsPerFire}
    />
    <Field name="system.ammo" label={localize('Mothership.Ammunition')} value={system.ammo} dtype="Number" />
  </div>
</div>

<!-- PSG 2 — the Combat Shotgun deals 4d10 up close and 1d10 at Long Range, and which applies is
     the table's call, so the weapon carries both. -->
<div class="damage-modes">
  <div class="damage-modes-heading">
    <span class="resource-label">{localize('Mothership.DamageModes')}</span>
    <button type="button" class="damage-mode-add" onclick={addMode}>
      <i class="fas fa-plus"></i>{localize('Mothership.AddDamageMode')}
    </button>
  </div>

  {#each rows as mode, index (index)}
    <div class="damage-mode">
      <input
        type="text"
        value={mode.label}
        placeholder={localize('Mothership.DamageModeLabelField')}
        onchange={edit(index, 'label')}
      />
      <input
        type="text"
        value={mode.formula}
        placeholder={localize('Mothership.Damage')}
        onchange={edit(index, 'formula')}
      />
      <button
        type="button"
        class="damage-mode-remove"
        title={localize('Mothership.RemoveDamageMode')}
        aria-label={localize('Mothership.RemoveDamageMode')}
        onclick={() => removeMode(index)}
      >
        <i class="fas fa-trash"></i>
      </button>
    </div>
  {/each}
</div>

<style>
  /* @layer system outranks Svelte's unlayered component CSS. */
  @layer system {
    .damage-modes {
      --weapon-modes-gap: var(--space-4);
      --weapon-modes-margin-block: var(--space-10);

      display: flex;
      flex-direction: column;
      gap: var(--weapon-modes-gap);
      margin-block: var(--weapon-modes-margin-block);
    }

    .damage-modes-heading {
      --weapon-modes-heading-gap: var(--space-8);

      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: var(--weapon-modes-heading-gap);
    }

    .damage-mode {
      --weapon-mode-gap: var(--space-4);
      --weapon-mode-label-width: 2fr;
      --weapon-mode-formula-width: 3fr;
      --weapon-mode-control-width: var(--space-24);

      display: grid;
      grid-template-columns:
        var(--weapon-mode-label-width) var(--weapon-mode-formula-width)
        var(--weapon-mode-control-width);
      gap: var(--weapon-mode-gap);
      align-items: center;
    }

    .damage-mode-add,
    .damage-mode-remove {
      --weapon-mode-button-gap: var(--space-4);
      --weapon-mode-button-text: var(--text-secondary);

      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--weapon-mode-button-gap);
      border: 0;
      background: none;
      color: var(--weapon-mode-button-text);
      cursor: pointer;
    }

    .damage-mode-add:hover,
    .damage-mode-remove:hover {
      --weapon-mode-button-text: var(--text-primary);
    }

    .damage-mode-add {
      --weapon-mode-add-font-size: var(--font-size-sm);

      font-size: var(--weapon-mode-add-font-size);
      padding: var(--space-0);
      width: auto;
    }
  }
</style>
