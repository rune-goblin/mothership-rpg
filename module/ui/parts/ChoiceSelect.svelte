<script>
  // The compact half of ChoiceList's job. Where that draws a table of rows — art, description,
  // trailing cells — this draws one native `<select>`, for a choice whose options are a short list
  // of bare names and where the window has no room to spend on rows.
  //
  // Native, not a built menu: the keyboard, the type-ahead and the closed-state rendering are the
  // platform's, exactly as ChoiceList leans on a native radio group for its arrow keys.
  let { options, value, onchange, label = '' } = $props();

  const uid = $props.id();
</script>

<div class="choice-select">
  <label class="choice-select-label" for={uid}>{label}</label>
  <select
    class="choice-select-input"
    id={uid}
    {value}
    onchange={(event) => onchange(event.currentTarget.value)}
  >
    {#each options as option (option.key)}
      <option value={option.key} disabled={option.disabled === true}>{option.label}</option>
    {/each}
  </select>
</div>

<style>
  @layer system {
    .choice-select {
      --choice-select-gap: var(--space-4);
      --choice-select-label-font-size: var(--font-size-md);
      --choice-select-label-text: var(--text-secondary);

      display: flex;
      flex-direction: column;
      gap: var(--choice-select-gap);
      min-width: 0;
    }

    .choice-select-label {
      font-family: var(--font-sans-mothership);
      font-size: var(--choice-select-label-font-size);
      color: var(--choice-select-label-text);
    }

    .choice-select-input {
      --choice-select-input-font-size: var(--font-size-lg);
      --choice-select-input-padding-block: var(--space-8);
      --choice-select-input-padding-inline: var(--space-12);
      --choice-select-input-border-width: var(--border-width-1);
      --choice-select-input-border-color: var(--border-strong);
      --choice-select-input-radius: var(--radius-2);
      --choice-select-input-surface: var(--surface-raised);
      --choice-select-input-text: var(--text-primary);

      width: 100%;
      padding: var(--choice-select-input-padding-block) var(--choice-select-input-padding-inline);
      font-family: var(--font-sans-mothership);
      font-size: var(--choice-select-input-font-size);
      color: var(--choice-select-input-text);
      background: var(--choice-select-input-surface);
      border: var(--choice-select-input-border-width) solid var(--choice-select-input-border-color);
      border-radius: var(--choice-select-input-radius);
    }

    .choice-select-input:focus-visible {
      outline: var(--border-width-2) solid var(--border-focus);
      outline-offset: var(--space-2);
    }
  }
</style>
