<script>
  import Editor from '../parts/Editor.svelte';
  import ItemCell from '../parts/ItemCell.svelte';
  import ItemControl from '../parts/ItemControl.svelte';
  import ItemControls from '../parts/ItemControls.svelte';
  import MainStat from '../parts/MainStat.svelte';
  import MinMaxField from '../parts/MinMaxField.svelte';
  import StatModifier from '../parts/StatModifier.svelte';
  import PipTrack from '../parts/PipTrack.svelte';
  import Stepper from '../parts/Stepper.svelte';
  import TabPanel from '../parts/TabPanel.svelte';
  import Tabs from '../parts/Tabs.svelte';
  import TextareaField from '../parts/TextareaField.svelte';
  import ArmorBlock from '../parts/sections/ArmorBlock.svelte';
  import HealthBlock from '../parts/sections/HealthBlock.svelte';
  import ItemPanel from '../parts/sections/ItemPanel.svelte';
  import { onActivate } from '../parts/activate.js';
  import { localize } from '../../i18n.ts';
  import {
    adjust,
    deleteItem,
    editItem,
    promptAddItem,
    stepBy,
    stepShots,
    toggleEquipped,
  } from './items.js';

  let { store } = $props();

  const doc = $derived(store.current);
  const system = $derived(doc.system);
  const actor = $derived(store.document);

  const armors = $derived(doc.items.filter((item) => item.type === 'armor'));
  const conditions = $derived(doc.items.filter((item) => item.type === 'condition'));
  const gear = $derived(doc.items.filter((item) => item.type === 'item'));
  const skills = $derived(doc.items.filter((item) => item.type === 'skill'));
  const weapons = $derived(doc.items.filter((item) => item.type === 'weapon'));

  let tab = $state('skills');

  const tabs = $derived([
    { id: 'skills', label: localize('Mothership.Skills') },
    { id: 'weapons', label: localize('Mothership.Weapons') },
    { id: 'armor', label: localize('Mothership.Armor') },
    { id: 'items', label: localize('Mothership.Items') },
    { id: 'conditions', label: localize('Mothership.Conditions') },
    { id: 'notes', label: localize('Mothership.Notes') },
  ]);

  // Paths are literal strings, not built from a key: test/sheet-bindings.test.ts checks each
  // against the schema and can only do that for a literal.
  const IDENTITY = [
    { name: 'system.credits.value', label: 'Mothership.Credits' },
    { name: 'system.class.value', label: 'Mothership.CLASS' },
    { name: 'system.pronouns.value', label: 'Mothership.Pronouns' },
    { name: 'system.attributes.level.value', label: 'Mothership.HighScore' },
  ];

  // Half a row each: both tables print a sentence rather than a word, so a quarter-width box
  // reads a patch as its first two syllables.
  const FLAVOUR = [
    { name: 'system.patch.value', label: 'Mothership.Patch' },
    { name: 'system.trinket.value', label: 'Mothership.Trinket' },
  ];

  const STATS = [
    { key: 'strength', label: 'Mothership.Strength' },
    { key: 'speed', label: 'Mothership.Speed' },
    { key: 'intellect', label: 'Mothership.Intellect' },
    { key: 'combat', label: 'Mothership.Combat' },
  ];

  const SAVES = [
    { key: 'sanity', label: 'Mothership.Sanity' },
    { key: 'fear', label: 'Mothership.Fear' },
    { key: 'body', label: 'Mothership.Body' },
  ];

  const at = (path) => path.split('.').reduce((node, key) => node?.[key], doc);

  const statRoll = (key) => () => actor.rollStat(key);

  const skillRoll = (id) => () => actor.rollSkill(id);

  const weaponRoll = (id) => () => actor.rollWeapon(id);

  const damageRoll = (id) => () => actor.rollWeapon(id, { roll: 'damage' });

  const step = (id, path, bounds) => (event) => adjust(actor, id, path, stepBy(event), bounds);

  const shotStep = (id) => (event) => stepShots(actor, id, stepBy(event));

  const panic = () => actor.rollPanic();

  const setCover = (cover) => actor.update({ 'system.stats.armor.cover': cover });
</script>

<header class="char-header header-grid">
  <div class="header-fields header-grid">
    <div class="header">
      <img
        class="profile"
        src={doc.img}
        data-action="editImage"
        data-edit="img"
        title={doc.name}
        alt={doc.name}
        height="150"
        width="150"
      />

      <div class="headergrid">
        <div class="headernamegrid">
          <div class="headerinputtext">{localize('Mothership.Name')}</div>
          <div class="headerinputfield">
            <input
              name="name"
              class="noborder"
              type="text"
              value={doc.name}
              placeholder={localize('Mothership.Name')}
            />
          </div>
        </div>

        {#each IDENTITY as field (field.name)}
          {@render identityField(field)}
        {/each}

        {#each FLAVOUR as field (field.name)}
          <div class="headerwide">{@render identityField(field)}</div>
        {/each}
      </div>
    </div>

    <div class="health vitals">
      <div class="tracks">
        <HealthBlock health={system.health} hits={system.hits} />

        <MinMaxField
          label={localize('Mothership.Stress')}
          labelClass="rollable"
          onroll={panic}
          name="system.other.stress.value"
          value={system.other.stress.value}
          rightName="system.other.stress.min"
          rightValue={system.other.stress.min}
          leftLabel={localize('Mothership.Current')}
          rightLabel={localize('Mothership.Minimum')}
        />
      </div>

      <div class="armor">
        <ArmorBlock armor={system.stats.armor} oncover={setCover} />
      </div>
    </div>

    <div class="abilities rail">
      <div class="resource-label minmaxtext">{localize('Mothership.Stats')}</div>

      <div class="rail-stack">
        {#each STATS as stat (stat.key)}
          {@render checkStat(stat)}
        {/each}
      </div>
    </div>

    <div class="saves rail">
      <div class="resource-label minmaxtext">{localize('Mothership.Saves')}</div>

      <div class="rail-stack">
        {#each SAVES as save (save.key)}
          {@render checkStat(save)}
        {/each}
      </div>
    </div>

    <div class="trauma">
      <TextareaField
        fill
        name="system.other.stressdesc.value"
        label={localize('Mothership.TraumaResponse')}
        value={system.other.stressdesc.value}
      />
    </div>
  </div>
</header>

{#snippet identityField(field)}
  <div>
    <div class="headerinputtext">{localize(field.label)}</div>
    <div class="headerinputfield">
      <input name={field.name} class="noborder" type="text" value={at(field.name)} />
    </div>
  </div>
{/snippet}

{#snippet checkStat(stat)}
  {@const pod = system.stats[stat.key]}
  {@const mod = Number(pod.mod) || 0}
  <MainStat
    key={stat.key}
    label={localize(stat.label)}
    name="system.stats.{stat.key}.value"
    value={pod.value}
    adjusted={mod ? Number(pod.value) + mod : null}
    tone={mod > 0 ? 'up' : mod < 0 ? 'down' : null}
    onroll={statRoll(stat.key)}
  >
    {#snippet modifier()}
      <StatModifier
        name="system.stats.{stat.key}.mod"
        value={pod.mod}
        label={localize(stat.label)}
      />
    {/snippet}
  </MainStat>
{/snippet}

<Tabs {tabs} bind:active={tab} />

<section class="sheet-body">
  <TabPanel tab="notes" active={tab} class="biography">
    <div style="display: flex; flex-direction: column; height: 100%; gap: 6px;">
      <div class="item flex-group-left item-header">
        <div class="skill-stat">{localize('Mothership.Bio')}</div>
      </div>
      <div style="flex: 1; min-height: 0;">
        <Editor
          name="system.biography"
          value={system.biography}
          enriched={doc.enriched.biography}
          uuid={doc.uuid}
        />
      </div>
      <div class="item flex-group-left item-header">
        <div class="skill-stat">{localize('Mothership.Notes')}</div>
      </div>
      <div style="flex: 1; min-height: 0;">
        <Editor
          name="system.notes"
          value={system.notes}
          enriched={doc.enriched.notes}
          uuid={doc.uuid}
        />
      </div>
    </div>
  </TabPanel>

  <TabPanel tab="armor" active={tab} class="items">
    <ItemPanel
      headers={[
        { label: localize('Mothership.ArmorName'), grow: 2.5 },
        { label: localize('Mothership.AP') },
        { label: localize('Mothership.DR') },
        { label: localize('Mothership.Speed') },
        { label: localize('Mothership.Oxygen') },
        { label: localize('Mothership.Equipped') },
      ]}
      items={armors}
      create={{ title: localize('Mothership.CreateArmor'), onclick: () => promptAddItem(actor, 'armor') }}
      row={armorRow}
    />
  </TabPanel>

  <TabPanel tab="items" active={tab} class="items">
    <ItemPanel
      headers={[
        { label: localize('Mothership.ItemName'), grow: 1.5 },
        { label: localize('Mothership.Quantity') },
        ...(doc.hideWeight ? [] : [{ label: localize('Mothership.Weight') }]),
        { label: localize('Mothership.Value') },
      ]}
      items={gear}
      create={{ title: localize('Mothership.CreateItem'), onclick: () => promptAddItem(actor, 'item') }}
      row={gearRow}
    />

    {#if !doc.hideWeight}
      <div class="item flex-group-left item-header">
        <div class="skill-stat" style="flex-grow: 1.5;">
          {localize('Mothership.CarryingCapacity')}: {system.weight.capacity}
        </div>
        <div class="skill-stat">{localize('Mothership.CurrentWeight')}: {system.weight.current}</div>
      </div>
    {/if}
  </TabPanel>

  <TabPanel tab="skills" active={tab} class="items">
    <ItemPanel
      headers={[
        { label: localize('Mothership.SkillName') },
        { label: localize('Mothership.SkillRank') },
        { label: localize('Mothership.SkillBonus') },
      ]}
      items={skills}
      create={{ title: localize('Mothership.CreateSkill'), onclick: () => promptAddItem(actor, 'skill') }}
      row={skillRow}
    />
  </TabPanel>

  <TabPanel tab="conditions" active={tab} class="items">
    <ItemPanel
      headers={[
        { label: localize('Mothership.Condition') },
        { label: localize('Mothership.Severity') },
        { label: localize('Mothership.Treatment') },
      ]}
      items={conditions}
      create={{
        title: localize('Mothership.CreateCondition'),
        onclick: () => promptAddItem(actor, 'condition'),
      }}
      row={conditionRow}
    />
  </TabPanel>

  <TabPanel tab="weapons" active={tab} class="items">
    <ItemPanel
      headers={[
        { label: localize('Mothership.WeaponName'), grow: 2 },
        { label: localize('Mothership.Damage') },
        { label: localize('Mothership.Clips') },
        { label: localize('Mothership.Shots') },
        { label: localize('Mothership.Range') },
      ]}
      items={weapons}
      create={{ title: localize('Mothership.CreateWeapon'), onclick: () => promptAddItem(actor, 'weapon') }}
      row={weaponRow}
    />
  </TabPanel>
</section>

{#snippet armorRow(armor, disclose)}
  <ItemCell variant="name" grow={2.55} roll={!!disclose} onclick={disclose}>{armor.name}</ItemCell>
  <ItemCell
    roll
    onclick={step(armor.id, 'armorPoints')}
    oncontextmenu={step(armor.id, 'armorPoints', { min: 0 })}
  >
    {armor.system.armorPoints}
  </ItemCell>
  <ItemCell
    roll
    onclick={step(armor.id, 'damageReduction')}
    oncontextmenu={step(armor.id, 'damageReduction', { min: 0 })}
  >
    {armor.system.damageReduction}
  </ItemCell>
  <ItemCell>{armor.system.speed}</ItemCell>
  {#if armor.system.oxygenMax}
    <ItemCell
      roll
      onclick={step(armor.id, 'oxygenCurrent', { max: armor.system.oxygenMax })}
      oncontextmenu={step(armor.id, 'oxygenCurrent', { min: 0 })}
    >
      {armor.system.oxygenCurrent}/{armor.system.oxygenMax}
    </ItemCell>
  {:else}
    <ItemCell>{localize('Mothership.NA')}</ItemCell>
  {/if}
  <ItemCell>
    <input
      type="checkbox"
      checked={armor.system.equipped}
      onchange={() => toggleEquipped(actor, armor.id)}
    />
  </ItemCell>
  <ItemControls>
    <ItemControl
      icon="edit"
      title={localize('Mothership.EditArmor')}
      onclick={() => editItem(actor, armor.id)}
    />
    <ItemControl
      icon="trash"
      title={localize('Mothership.DeleteArmor')}
      onclick={() => deleteItem(actor, armor.id)}
    />
  </ItemControls>
{/snippet}

{#snippet gearRow(item, disclose)}
  <ItemCell variant="name" grow={doc.hideWeight ? 1.5 : 1.54} roll={!!disclose} onclick={disclose}>
    {item.name}
  </ItemCell>
  <ItemCell roll onclick={step(item.id, 'quantity')} oncontextmenu={step(item.id, 'quantity')}>
    {item.system.quantity}
  </ItemCell>
  {#if !doc.hideWeight}
    <ItemCell>{item.system.weight}</ItemCell>
  {/if}
  <ItemCell>{item.system.cost}</ItemCell>
  <ItemControls>
    <ItemControl
      icon="edit"
      title={localize('Mothership.EditItem')}
      onclick={() => editItem(actor, item.id)}
    />
    <ItemControl
      icon="trash"
      title={localize('Mothership.DeleteItem')}
      onclick={() => deleteItem(actor, item.id)}
    />
  </ItemControls>
{/snippet}

{#snippet skillRow(skill)}
  <ItemCell variant="name" die roll onclick={skillRoll(skill.id)}>{skill.name}</ItemCell>
  <ItemCell>{skill.system.rank}</ItemCell>
  <ItemCell>{skill.system.bonus}</ItemCell>
  <ItemControls>
    <ItemControl
      icon="edit"
      title={localize('Mothership.EditSkill')}
      onclick={() => editItem(actor, skill.id)}
    />
    <ItemControl
      icon="trash"
      title={localize('Mothership.DeleteSkill')}
      onclick={() => deleteItem(actor, skill.id)}
    />
  </ItemControls>
{/snippet}

{#snippet conditionRow(condition, disclose)}
  <ItemCell variant="name" roll={!!disclose} onclick={disclose}>{condition.name}</ItemCell>
  <ItemCell
    roll
    onclick={step(condition.id, 'severity')}
    oncontextmenu={step(condition.id, 'severity', { min: 0 })}
  >
    {condition.system.severity}
  </ItemCell>
  <ItemCell>
    <div
      class="list-roll flex"
      style="margin: 0; position: relative; top: 50%; -ms-transform: translateY(-50%); transform: translateY(-50%);"
      role="button"
      tabindex="0"
      onclick={step(condition.id, 'treatment.value', { max: 3 })}
      oncontextmenu={step(condition.id, 'treatment.value', { min: 0 })}
      onkeydown={onActivate(step(condition.id, 'treatment.value', { max: 3 }))}
    >
      <PipTrack count={3} value={condition.system.treatment.value} />
    </div>
  </ItemCell>
  <ItemControls>
    <ItemControl
      icon="edit"
      title={localize('Mothership.EditCondition')}
      onclick={() => editItem(actor, condition.id)}
    />
    <ItemControl
      icon="trash"
      title={localize('Mothership.DeleteCondition')}
      onclick={() => deleteItem(actor, condition.id)}
    />
  </ItemControls>
{/snippet}

{#snippet weaponRow(weapon)}
  <ItemCell variant="name" die grow={2.05} roll onclick={weaponRoll(weapon.id)}>{weapon.name}</ItemCell>
  <ItemCell roll onclick={damageRoll(weapon.id)}>
    {weapon.system.damage}{weapon.system.antiArmor
      ? ` (${localize('Mothership.AntiArmorAcronym')})`
      : ''}
  </ItemCell>
  {#if weapon.system.useAmmo}
    <ItemCell>
      <Stepper
        value={weapon.system.ammo}
        label={localize('Mothership.Clips')}
        min={0}
        onstep={(delta) => adjust(actor, weapon.id, 'ammo', delta, { min: 0 })}
      />
    </ItemCell>
    <ItemCell>
      <a
        class="list-roll"
        href={null}
        role="button"
        tabindex="0"
        title={weapon.system.curShots === weapon.system.shots
          ? localize('Mothership.EditWeapon')
          : undefined}
        onclick={shotStep(weapon.id)}
        oncontextmenu={shotStep(weapon.id)}
        onkeydown={onActivate(shotStep(weapon.id))}
      >
        {weapon.system.curShots}/{weapon.system.shots}
      </a>
      {#if weapon.system.curShots !== weapon.system.shots}
        <a
          class="list-roll"
          href={null}
          role="button"
          tabindex="0"
          title={localize('Mothership.Reload')}
          onclick={() => actor.reloadWeapon(weapon.id)}
          onkeydown={onActivate(() => actor.reloadWeapon(weapon.id))}
        >
          <i class="fas fa-sync"></i>
        </a>
      {/if}
    </ItemCell>
  {:else}
    <ItemCell>{localize('Mothership.NA')}</ItemCell>
    <ItemCell>{localize('Mothership.NA')}</ItemCell>
  {/if}
  <ItemCell>{localize(`Mothership.RangeBand.${weapon.system.range}`)}</ItemCell>
  <ItemControls>
    <ItemControl
      icon="edit"
      title={localize('Mothership.EditWeapon')}
      onclick={() => editItem(actor, weapon.id)}
    />
    <ItemControl
      icon="trash"
      title={localize('Mothership.DeleteWeapon')}
      onclick={() => deleteItem(actor, weapon.id)}
    />
  </ItemControls>
{/snippet}

<style>
  /* @layer system: Svelte emits component CSS unlayered, which would outrank the rest of the
     application's layered rules. */
  @layer system {
    .char-header {
      --charactersheet-header-grid-gap: var(--space-10);
      --charactersheet-header-grid-padding: var(--space-2);

      /* Every column is as wide as its own widest content and no wider; the window's slack goes
         into the gutters instead of stretching four boxes that have nothing to stretch for.
         Measured, not guessed:
           rail    — "Strength" plus its die plus the 4.6em circle column. Clips below 214px.
           tracks  — the "Current"/"Maximum" caption pair, 117px; the numbers never reach three
                     digits, so the boxes themselves want far less than the words under them.
           armor   — "Insignificant Cover" on one line inside the cover chip. */
      --charactersheet-rail-width: 224px;
      --charactersheet-tracks-width: 126px;
      --charactersheet-armor-width: 156px;

      --charactersheet-identity-gap: var(--space-4);
      --charactersheet-identity-padding: var(--space-16);

      /* The vitals rows, measured off the blocks they hold, not off the spacing scale. */
      --charactersheet-vitals-row-height: 76px;

      /* The caption above every column: 16px of type over a 4px margin. The boxes in the middle
         columns start on the line beneath it, and so must the rails. */
      --charactersheet-caption-height: 20px;

      /* A pill is 35px inside a 46px row because the number circle beside it is taller and the
         two are centred on each other, so its black edge starts 5.5px down. Lifting the stack by
         that much is what puts the pills on the boxes' top line. */
      --charactersheet-pill-inset: 5.5px;

      /* `.mainstat`'s own value column holds the circle but not the modifier badge riding past
         it, which the panel's padding used to pay for. The saves rail ends on the sheet's own
         edge, so the badge is otherwise the one thing hanging over it. */
      --charactersheet-stat-value-column: 5.2em;

      --charactersheet-rail-gap: var(--space-16);
    }

    /* Selector must stay chained: `centercol`/`mobilehealth` are claimed by
       `.mothership .health` in css/mothership.css, which this block cannot take.

       Four columns, not three: the vitals split into tracks and armour, and putting that split in
       the header grid rather than inside the vitals is what makes all three gutters one
       measurement. `space-between` spends the window's slack on them -- widening the sheet opens
       the gutters and leaves the contents alone -- and the gap is the floor they close to. */
    .char-header .header-grid {
      display: grid;
      grid-template-areas:
        'header header header header'
        'abilities tracks armor saves'
        'abilities tracks trauma trauma'
        'mobilehealth mobilehealth mobilehealth mobilehealth';
      grid-template-columns:
        var(--charactersheet-rail-width)
        var(--charactersheet-tracks-width)
        var(--charactersheet-armor-width)
        var(--charactersheet-rail-width);
      justify-content: space-between;
      gap: var(--charactersheet-header-grid-gap);
      padding: var(--charactersheet-header-grid-padding);
    }

    /* Named, and on the outer header rather than the grid itself: the grid has to answer the
       query too, and an element can never be measured against its own container. */
    .char-header {
      container: mothership-sheet / inline-size;
    }

    .abilities {
      grid-area: abilities;
    }

    /* The trauma response belongs to the saves, not to the vitals: it is the sentence a failed
       Fear save writes. */
    .saves {
      grid-area: saves;
      min-height: 0;
    }

    /* Stats and Saves are one control in one column shape, so nothing but a caption should tell
       the two rails apart -- the frame that used to fence the saves in said "different" about a
       column that isn't. The caption is the vitals' own, so all four columns of the header start
       on the same line of type. */
    .rail {
      display: grid;
      grid-template-rows: var(--charactersheet-caption-height) auto 1fr;
      align-content: start;
    }

    .rail-stack {
      display: grid;
      gap: var(--charactersheet-rail-gap);
      margin-top: calc(-1 * var(--charactersheet-pill-inset));
    }

    .char-header .rail :global(.mainstat) {
      grid-template-columns: minmax(0, 1fr) var(--charactersheet-stat-value-column);
    }

    /* The sentence needs two columns to reach two lines, so it sits under armour and saves rather
       than inside the rail it belongs to. It follows the saves down, not the tracks: armour ends
       where the rail does, and the tracks column runs past both. */
    .trauma {
      grid-area: trauma;
    }

    /* What empties on the left, what protects on the right. Health, Wounds and Stress are the
       three tracks a session spends, read straight down; armour is not a track, so it keeps its
       own column, with the cover it borrows hanging off the bottom.

       The wrapper is dissolved rather than a subgrid: each half takes its own row in the header
       grid too, which is what lets the trauma response start under the armour block while the
       tracks run on past it. The element stays for the narrow layout, which regroups them. */
    .vitals {
      display: contents;
    }

    .tracks {
      grid-area: tracks;
      align-self: start;
      display: grid;
      gap: var(--charactersheet-header-grid-gap);
    }

    .armor {
      grid-area: armor;
      align-self: start;
    }

    /* Each column is sized already, so its blocks fill it: `.healthspread`'s 96% was a way of
       finding a margin inside a stretchy column, and these no longer stretch. */
    .char-header .vitals > :global(*),
    .char-header .tracks > :global(*) {
      width: 100%;
    }

    /* Each track keeps its own row height. Without this the shorter of them stretches and its
       captions drift away from the box they name. */
    .tracks > :global(*) {
      height: var(--charactersheet-vitals-row-height);
    }

    .headergrid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: var(--charactersheet-identity-gap);
      padding: var(--charactersheet-identity-padding);
    }

    .headernamegrid {
      grid-column: 1/-2;
    }

    .headerwide {
      grid-column: span 2;
    }

    /* Below the width the four columns need -- their own widths plus three floor gutters and the
       padding -- the vitals drop under the two rails rather than squeezing what is already at its
       measured minimum. */
    @container mothership-sheet (max-width: 764px) {
      .char-header .header-grid {
        grid-template-areas:
          'header header'
          'abilities saves'
          'trauma trauma'
          'mobilehealth mobilehealth';
        grid-template-columns: var(--charactersheet-rail-width) var(--charactersheet-rail-width);
      }

      .vitals {
        display: grid;
        grid-area: mobilehealth;
        grid-template-columns: var(--charactersheet-tracks-width) var(--charactersheet-armor-width);
        justify-content: space-between;
        column-gap: var(--charactersheet-header-grid-gap);
      }

      /* The header grid's areas are gone at this width; without this the named lines resolve
         against implicit tracks and throw both halves out of the vitals. */
      .tracks,
      .armor {
        grid-area: auto;
      }
    }
  }
</style>
