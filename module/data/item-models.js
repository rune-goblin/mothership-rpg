import { ROLL_MODIFIERS, ROLL_SCOPES, WEAPON_RANGES } from '../rules.ts';

const { fields } = foundry.data;

const num = (initial, integer = false) =>
  new fields.NumberField({ required: true, nullable: false, initial, integer });

const str = (initial = '') => new fields.StringField({ required: true, blank: true, initial });

const bool = (initial = false) => new fields.BooleanField({ required: true, initial });

const uuidList = () => new fields.ArrayField(new fields.StringField());

const picks = () => ({
  trained: num(0),
  expert: num(0),
  expert_full_set: num(0),
  master: num(0),
  master_full_set: num(0),
});

const base = () => ({ description: new fields.HTMLField({ required: true, blank: true, initial: '' }) });

export class MothershipItemModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { ...base(), quantity: num(1, true), weight: num(0), cost: num(0) };
  }
}

export class MothershipSkillModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { ...base(), rank: str('Trained'), bonus: num(10), prerequisite_ids: uuidList() };
  }
}

export class MothershipWeaponModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...base(),
      antiArmor: bool(false),
      damage: str('1d10'),
      // Some weapons have a second damage the range decides (e.g. Combat Shotgun: 4d10 close,
      // 1d10 Long); the card offers every mode since the band is the fiction's to settle.
      damageModes: new fields.ArrayField(new fields.SchemaField({ label: str(''), formula: str('') })),
      ammo: num(10, true),
      shots: num(1, true),
      curShots: num(0, true),
      shotsPerFire: num(1, true),
      useAmmo: bool(false),
      ammoType: str(''),
      critDmg: str(''),
      woundEffect: str(''),
      bonus: num(0),
      weight: num(0),
      cost: num(0),
      // Ranges are bands, not distances -- the book gives no metres for them.
      range: new fields.StringField({
        required: true,
        blank: false,
        initial: 'none',
        choices: WEAPON_RANGES,
      }),
    };
  }
}

export class MothershipArmorModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...base(),
      armorPoints: num(1),
      damageReduction: num(0),
      speed: str(''),
      oxygenMax: num(0),
      oxygenCurrent: num(0),
      weight: num(0),
      cost: num(0),
      // Must stay declared here: a SchemaField silently drops undeclared keys, and the armor
      // sheet binds this one.
      equipped: bool(false),
      features: str(''),
    };
  }
}

export class MothershipAbilityModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { ...base(), roll: str('') };
  }
}

export class MothershipConditionModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...base(),
      severity: num(1),
      treatment: new fields.SchemaField({ value: num(0) }),
      // No initial on either key: a row naming only half of itself isn't a modifier.
      modifiers: new fields.ArrayField(
        new fields.SchemaField({
          modifier: new fields.StringField({ required: true, choices: ROLL_MODIFIERS }),
          scope: new fields.StringField({ required: true, choices: ROLL_SCOPES }),
        }),
      ),
    };
  }
}

export class MothershipClassModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...base(),
      trauma_response: str(''),
      robotic: bool(true),
      // The generator's draft copies every key here except skills_granted straight into its
      // bonus map, so any key added is applied as a stat bonus.
      base_adjustment: new fields.SchemaField({
        strength: num(0),
        speed: num(0),
        intellect: num(0),
        combat: num(0),
        sanity: num(0),
        fear: num(0),
        body: num(0),
        max_wounds: num(0),
        skills_granted: uuidList(),
      }),
      // choose_skill_or is an array of *groups*, each a set of packages the player takes one
      // of; a package and choose_skill_and share the same pick-set shape via `picks()`.
      selected_adjustment: new fields.SchemaField({
        choose_stat: new fields.ArrayField(
          new fields.SchemaField({
            modification: num(0),
            stats: new fields.ArrayField(new fields.StringField()),
          }),
        ),
        choose_skill_and: new fields.SchemaField(picks()),
        choose_skill_or: new fields.ArrayField(
          new fields.ArrayField(
            new fields.SchemaField({ name: str(''), ...picks(), from_list: uuidList() }),
          ),
        ),
      }),
      roll_tables: new fields.SchemaField({
        loadout: str(''), trinket: str(''), patch: str(''),
      }),
    };
  }
}

export const ITEM_MODELS = {
  item: MothershipItemModel,
  skill: MothershipSkillModel,
  weapon: MothershipWeaponModel,
  armor: MothershipArmorModel,
  ability: MothershipAbilityModel,
  condition: MothershipConditionModel,
  class: MothershipClassModel,
};
