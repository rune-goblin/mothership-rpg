<script>
  import ChoiceList from '../ui/parts/ChoiceList.svelte';
  import ChoiceSelect from '../ui/parts/ChoiceSelect.svelte';

  // The body every dialog in this directory is drawn from: the head that names the question, the
  // list that answers it, and the note a condition adds. Everything a caller needs beyond those
  // three arrives as `children` — the roll's own sum, and nothing else so far.
  let {
    heading,
    intro = '',
    /** The number the roll is measured against, or the dice about to be thrown: `{ label, value }`. */
    readout = null,
    image = '',
    options = null,
    value = null,
    onchange = () => {},
    lines = 2,
    note = '',
    /** Drawn in each row's right-hand cell, in place of the row's own cells. */
    trailing = null,
    expanded = false,
    /** `select` for a short list of bare names; `list` draws the rows, art and descriptions. */
    picker = 'list',
    children = null,
  } = $props();
</script>

<div class="prompt-head">
  {#if image}<img class="prompt-art" src={image} alt="" />{/if}
  <div class="prompt-head-text">
    <h2 class="prompt-heading">{heading}</h2>
    {#if intro}<p class="prompt-intro">{@html intro}</p>{/if}
  </div>
  {#if readout}
    <p class="prompt-readout">
      <span class="prompt-readout-label">{readout.label}</span>
      <span class="prompt-readout-value">{readout.value}</span>
    </p>
  {/if}
</div>

<div class="prompt-body">
  {#if options}
    {#if picker === 'select'}
      <ChoiceSelect {options} {value} {onchange} label={heading} />
    {:else}
      <ChoiceList {options} {value} {onchange} {lines} {trailing} {expanded} label={heading} />
    {/if}
  {/if}

  {@render children?.()}

  {#if note}
    <p class="prompt-note">{note}</p>
  {/if}
</div>

<style>
  @layer system {
    /* The two tracks beneath this row are declared in css/mothership.css, not here: the roll
       rail is Foundry's own `.form-footer`, which no scoped block can reach. */
    .prompt-head {
      --prompt-head-gap: var(--space-20);
      --prompt-head-rule-width: var(--border-width-2);
      --prompt-head-rule-color: var(--border-danger);

      grid-column: 1 / -1;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--prompt-head-gap);
      padding-bottom: var(--space-8);
      border-bottom: var(--prompt-head-rule-width) solid var(--prompt-head-rule-color);
    }

    .prompt-head-text {
      flex: 1 1 auto;
      min-width: 0;
    }

    .prompt-art {
      --prompt-art-size: 72px;

      flex: 0 0 auto;
      align-self: center;
      width: var(--prompt-art-size);
      height: var(--prompt-art-size);
      object-fit: contain;
      border: none;
    }

    .prompt-heading {
      --prompt-heading-font-family: var(--font-display);
      --prompt-heading-font-size: var(--font-size-2xl);
      --prompt-heading-font-weight: var(--font-weight-semibold);
      --prompt-heading-text: var(--text-primary);

      margin: var(--space-0) var(--space-0) var(--space-2);
      font-family: var(--prompt-heading-font-family);
      font-size: var(--prompt-heading-font-size);
      font-weight: var(--prompt-heading-font-weight);
      line-height: var(--line-height-tighter);
      color: var(--prompt-heading-text);
      border: none;
    }

    .prompt-intro {
      --prompt-intro-font-size: var(--font-size-md);
      --prompt-intro-text: var(--text-secondary);

      margin: var(--space-0);
      font-family: var(--font-sans-mothership);
      font-size: var(--prompt-intro-font-size);
      line-height: var(--line-height-normal);
      color: var(--prompt-intro-text);
    }

    .prompt-intro :global(strong) {
      color: var(--text-primary);
      font-weight: var(--font-weight-semibold);
    }

    .prompt-readout {
      --prompt-readout-gap: 0.4em;
      --prompt-readout-label-font-size: var(--font-size-lg);
      --prompt-readout-label-text: var(--text-secondary);
      --prompt-readout-value-font-size: var(--font-size-4xl);
      --prompt-readout-value-text: var(--text-primary);

      display: flex;
      align-items: baseline;
      gap: var(--prompt-readout-gap);
      margin: var(--space-0);
      font-family: var(--font-display);
      line-height: var(--line-height-none);
      white-space: nowrap;
    }

    .prompt-readout-label {
      font-size: var(--prompt-readout-label-font-size);
      font-weight: var(--font-weight-medium);
      color: var(--prompt-readout-label-text);
    }

    .prompt-readout-value {
      font-size: var(--prompt-readout-value-font-size);
      font-weight: var(--font-weight-bold);
      font-variant-numeric: tabular-nums;
      color: var(--prompt-readout-value-text);
    }

    .prompt-body {
      display: flex;
      flex-direction: column;
      gap: var(--space-8);
      min-width: 0;
    }

    /* Red and italic: what a condition has to say about the roll about to be made. */
    .prompt-note {
      --prompt-note-font-size: var(--font-size-md);
      --prompt-note-text: var(--color-danger-500);

      margin: var(--space-0);
      font-size: var(--prompt-note-font-size);
      font-style: italic;
      color: var(--prompt-note-text);
    }
  }
</style>
