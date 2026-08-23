<script module>
  export const meta = {
    group: 'Dialog bodies',
    title: 'Prompt — which Wound table',
    path: 'module/dialogs/Prompt.svelte',
    width: 660,
    note: 'The five Wound tables as one dropdown — bare names, and the head already carries the art, so the rows ChoiceList would draw buy nothing here; the roll-type buttons are the dialog’s footer stood up as the rail.',
  };
</script>

<script>
  import Prompt from '../../module/dialogs/Prompt.svelte';
  import { asset } from '../../module/chat/cards.ts';
  import { localize } from '../../module/i18n.ts';
  import RailFrame from './RailFrame.svelte';

  // `WOUND_ICONS` is private to prompts.ts; these are the five keys and files it names.
  const ICONS = {
    bleeding: 'wounds_bleeding.png',
    'blunt-force': 'wounds_blunt_force.png',
    'fire-explosives': 'wounds_fire_&_explosives.png',
    'gore-massive': 'wounds_gore_&_massive.png',
    gunshot: 'wounds_gunshot.png',
  };

  const options = Object.entries(ICONS).map(([key, icon]) => ({
    key,
    label: localize(`Mothership.Table.${key}`),
    img: asset(`images/icons/ui/rolltables/${icon}`),
  }));

  const buttons = [
    { action: 'none', label: localize('Mothership.Normal'), icon: 'roll-mark', default: true },
    { action: 'advantage', label: localize('Mothership.Advantage'), icon: 'roll-mark roll-mark-advantage' },
    {
      action: 'disadvantage',
      label: localize('Mothership.Disadvantage'),
      icon: 'roll-mark roll-mark-disadvantage',
    },
  ];

  let value = $state('blunt-force');
</script>

<RailFrame {buttons}>
  <Prompt
    image={asset('images/icons/ui/macros/wound_roll.png')}
    heading={localize('Mothership.WoundRoll')}
    intro={localize('Mothership.WhatAWoundRollIs')}
    {options}
    picker="select"
    {value}
    onchange={(next) => (value = next)}
  />
</RailFrame>
