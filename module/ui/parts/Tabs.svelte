<script>
  import { onActivate } from './activate.js';

  let {
    tabs,
    active = $bindable(),
    group = 'primary',
    id,
    style = 'height: auto;',
  } = $props();

  const select = (tab) => () => (active = tab.id);
</script>

<nav class="mothership sheet-tabs tabs" {id} {style} data-group={group}>
  {#each tabs as tab (tab.id)}
    <a
      class="tab-select"
      class:active={active === tab.id}
      data-tab={tab.id}
      href={null}
      role="tab"
      tabindex="0"
      aria-selected={active === tab.id}
      onclick={select(tab)}
      onkeydown={onActivate(select(tab))}
    >
      {tab.label}
    </a>
  {/each}
</nav>

<style>
  @layer system {
    nav {
      --tabs-bar-surface: var(--surface-neutral-lowest);
      --tabs-bar-text: var(--text-inverted);
      --tabs-bar-height: var(--space-40);
      --tabs-bar-padding-block: var(--space-6);
      --tabs-bar-padding-inline: var(--space-0);
      --tabs-bar-radius: var(--radius-md);
      --tabs-bar-border-width: var(--border-width-2);
      --tabs-bar-border-color: var(--border-neutral-faint);

      --tabs-item-text: var(--text-inverted);
      --tabs-item-font-size: var(--font-size-lg);
      --tabs-item-font-weight: var(--font-weight-bold);
      --tabs-item-active-text-shadow: 0 0 10px var(--text-inverted);
      --tabs-bar-gap: var(--space-16);
      /* A ratio, not a length: the bar and the tabs run different font sizes, and this is what
         makes each tab's box the full height of the bar off its own. Foundry's `nav.tabs` used
         to supply it -- along with the flex row below -- so the strip was laid out by core. */
      --tabs-item-line-height: 2.5;

      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-evenly;
      gap: var(--tabs-bar-gap);
      flex: 0;
      height: var(--tabs-bar-height);
      padding: var(--tabs-bar-padding-block) var(--tabs-bar-padding-inline);
      border-top: var(--tabs-bar-border-width) solid var(--tabs-bar-border-color);
      border-bottom: var(--tabs-bar-border-width) solid var(--tabs-bar-border-color);
      border-radius: var(--tabs-bar-radius);
      background: var(--tabs-bar-surface);
      color: var(--tabs-bar-text);
    }

    .tab-select {
      color: var(--tabs-item-text);
      font-size: var(--tabs-item-font-size);
      font-weight: var(--tabs-item-font-weight);
      line-height: var(--tabs-item-line-height);
      text-align: center;

      &.active {
        text-decoration: underline;
        text-shadow: var(--tabs-item-active-text-shadow);
      }
    }
  }
</style>
