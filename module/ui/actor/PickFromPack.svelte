<script>
  import ChoiceList from '../parts/ChoiceList.svelte';

  let {
    filterLabel,
    headers,
    rows,
    enforceLabel = '',
    createLabel = '',
    /** Opens the new-item form; answers with the document it wrote, or null. Null draws no Create. */
    oncreate = null,
    /** Finishes this dialog without answering it — svelte-dialog hands it in. */
    close = null,
    /** Rebuilds the rows from the world. Null leaves the list as it was handed over. */
    reload = null,
    value,
    onchange,
  } = $props();

  // svelte-ignore state_referenced_locally
  let live = $state(rows);
  // svelte-ignore state_referenced_locally
  let enforce = $state(enforceLabel !== '');

  // The world half of the list is live: a document created elsewhere has to arrive here, and one
  // deleted elsewhere has to leave.
  $effect(() => {
    const hooks = globalThis.Hooks;
    if (reload === null || hooks === undefined) return;
    const refresh = () => {
      live = reload();
    };
    const listeners = ['createItem', 'updateItem', 'deleteItem'].map((hook) => [
      hook,
      hooks.on(hook, refresh),
    ]);
    return () => {
      for (const [hook, id] of listeners) hooks.off(hook, id);
    };
  });

  const barred = (row) => enforce && row.unmet === true;

  const options = $derived(
    live.map((row) => ({
      key: row.id,
      label: row.name,
      cells: row.cells,
      group: row.group,
      disabled: barred(row),
    })),
  );

  // Turning enforcement on can bar the row already picked; a barred pick must not survive as
  // the dialog's answer.
  const toggleEnforce = (event) => {
    enforce = event.currentTarget.checked;
    const current = live.find((row) => row.id === value);
    if (current !== undefined && barred(current)) onchange(null);
  };
</script>

{#snippet controls()}
  {#if enforceLabel !== ''}
    <label class="pick-enforce">
      <input type="checkbox" id="pick-enforce" checked={enforce} onchange={toggleEnforce} />
      {enforceLabel}
    </label>
  {/if}
  {#if oncreate !== null}
    <!-- `type="button"`, or it submits the dialog's form and answers it — and this control must
         leave the picker standing while the form is open, then take it down once one is written. -->
    <button
      type="button"
      id="pick-create"
      class="pick-create"
      onclick={async () => {
        if ((await oncreate()) !== null) close?.();
      }}
    >
      <i class="fas fa-plus" aria-hidden="true"></i>{createLabel}
    </button>
  {/if}
{/snippet}

<ChoiceList
  {filterLabel}
  {headers}
  {options}
  {value}
  {onchange}
  label={headers[0]}
  aside={enforceLabel === '' && oncreate === null ? null : controls}
/>

<style>
  @layer system {
    .pick-enforce {
      --pick-from-pack-enforce-font-size: var(--font-size-sm);
      --pick-from-pack-enforce-text: var(--text-secondary);

      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--space-6);
      font-family: var(--font-sans-mothership);
      font-size: var(--pick-from-pack-enforce-font-size);
      color: var(--pick-from-pack-enforce-text);
      white-space: nowrap;
    }

    .pick-create {
      --pick-from-pack-create-font-size: var(--font-size-md);
      --pick-from-pack-create-surface: var(--surface-neutral-paper);
      --pick-from-pack-create-border-color: var(--border-neutral-ink);
      --pick-from-pack-create-text: var(--text-primary);

      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--space-6);
      width: auto;
      height: auto;
      margin: var(--space-0);
      padding: var(--space-6) var(--space-12);
      font-family: var(--font-sans-mothership);
      font-size: var(--pick-from-pack-create-font-size);
      font-weight: var(--font-weight-semibold);
      white-space: nowrap;
      color: var(--pick-from-pack-create-text);
      background: var(--pick-from-pack-create-surface);
      border: var(--border-width-1) solid var(--pick-from-pack-create-border-color);
      border-radius: var(--radius-sm);
    }

    .pick-create:hover {
      --pick-from-pack-create-surface: var(--surface-neutral-lower);
      --pick-from-pack-create-text: var(--text-inverted);
    }
  }
</style>
