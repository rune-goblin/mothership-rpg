<script module>
  export const meta = {
    group: 'Primitives',
    title: 'ChoiceSelect',
    path: 'module/ui/parts/ChoiceSelect.svelte',
    width: 420,
    note: 'ChoiceList’s compact sibling: one native select, for a choice whose options are a short list of bare names. Native so the keyboard, the type-ahead and the closed state are the platform’s.',
  };
</script>

<script>
  import ChoiceSelect from '../../module/ui/parts/ChoiceSelect.svelte';
  import { localize } from '../../module/i18n.ts';

  const KEYS = ['bleeding', 'blunt-force', 'fire-explosives', 'gore-massive', 'gunshot'];
  const options = KEYS.map((key) => ({ key, label: localize(`Mothership.Table.${key}`) }));

  let value = $state('blunt-force');
</script>

<ChoiceSelect {options} {value} onchange={(next) => (value = next)} label="Wound Roll" />
