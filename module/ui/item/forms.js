import { localize } from '../../i18n.ts';
import SkillSheet from '../skill/SkillSheet.svelte';
import ItemSheet from './ItemSheet.svelte';

export async function itemContext(doc) {
  const { TextEditor } = foundry.applications.ux;
  return {
    enriched: {
      description: await TextEditor.implementation.enrichHTML(doc.system.description ?? '', {
        relativeTo: doc,
      }),
    },
  };
}

/**
 * `item` is null when a UUID no longer resolves — rendered as removable. `key` includes the
 * index because a stored list can hold the same UUID twice.
 */
export async function skillContext(doc) {
  const prerequisites = await Promise.all(
    doc.system.prerequisite_ids.map(async (uuid, index) => ({
      key: `${index}-${uuid}`,
      uuid,
      item: await fromUuid(uuid),
    })),
  );
  return { ...(await itemContext(doc)), prerequisites };
}

const EMPTY = { enriched: { description: '' } };

const FORMS = {
  skill: { component: SkillSheet, context: skillContext, blank: { ...EMPTY, prerequisites: [] } },
};

const SHARED = { component: ItemSheet, context: itemContext, blank: EMPTY };

/** The sheet body a type edits with, the async context it reads, and that context empty. */
export const formFor = (type) => FORMS[type] ?? SHARED;

const NEW_NAMES = {
  ability: 'Mothership.NewAbility',
  armor: 'Mothership.NewArmor',
  condition: 'Mothership.NewCondition',
  item: 'Mothership.NewGear',
  skill: 'Mothership.NewSkill',
  weapon: 'Mothership.NewWeapon',
};

export const newItemName = (type) => localize(NEW_NAMES[type]);

/**
 * The DataModel's own initial values, so a draft opens on what a created item would hold rather
 * than on blanks the schema would have filled in anyway.
 */
function systemDefaults(type) {
  const Model = globalThis.CONFIG?.Item?.dataModels?.[type];
  return Model === undefined ? {} : new Model({}).toObject();
}

export const draftItem = (type) => ({
  name: newItemName(type),
  type,
  img: globalThis.CONFIG?.Item?.documentClass?.DEFAULT_ICON,
  system: systemDefaults(type),
});
