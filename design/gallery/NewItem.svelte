<script module>
  export const meta = {
    group: 'Dialog bodies',
    title: 'NewItem',
    path: 'module/ui/item/NewItem.svelte',
    covers: ['module/ui/item/forms.js'],
    width: 600,
    note: 'The item sheet’s own form standing over a draft nothing has written yet, so the dialog’s three buttons — Save to World, Add to Character, Cancel — are what decide where it lands. Switch the type to see each body inside the dialog.',
  };
</script>

<script>
  import NewItem from '../../module/ui/item/NewItem.svelte';
  import { draftItem, formFor } from '../../module/ui/item/forms.js';
  import { createDraftStore } from '../../module/ui/document-store.svelte.js';
  import { ITEM_BODIES } from '../../module/ui/item/types.js';

  const types = [...Object.keys(ITEM_BODIES), 'skill'];
  let type = $state('weapon');

  const form = $derived(formFor(type));
  const store = $derived(createDraftStore(draftItem(type), form.context, form.blank));
</script>

<div class="ds-switch">
  {#each types as option (option)}
    <button type="button" class:active={type === option} onclick={() => (type = option)}>{option}</button>
  {/each}
</div>

<div class="mothership macro-popup-dialog">
  {#key type}
    <NewItem {store} component={form.component} />
  {/key}
</div>
