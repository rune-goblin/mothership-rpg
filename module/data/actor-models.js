const { fields } = foundry.data;

const num = (initial, integer = false) =>
  new fields.NumberField({ required: true, nullable: false, initial, integer });

const str = (initial = '') => new fields.StringField({ required: true, blank: true, initial });

const bool = (initial = false) => new fields.BooleanField({ required: true, initial });

const html = (initial = '') => new fields.HTMLField({ required: true, blank: true, initial });

const pool = (value, max, label, { min = 0, withMax = true } = {}) =>
  new fields.SchemaField({
    value: num(value),
    min: num(min),
    ...(withMax ? { max: num(max) } : {}),
    label: str(label),
  });

// Characters carry `mod`, creatures `enabled`, armour both plus cover/damageReduction —
// flags avoid three near-identical schemas.
const stat = (value, label, rollLabel, { mod = false, enabled = null, armor = false } = {}) =>
  new fields.SchemaField({
    value: num(value),
    ...(mod || armor ? { mod: num(0) } : {}),
    min: num(0),
    max: num(99),
    ...(armor ? { damageReduction: num(0), cover: str('none') } : {}),
    label: str(label),
    rollLabel: str(rollLabel),
    ...(enabled === null ? {} : { enabled: bool(enabled) }),
  });

const counter = (value, max) => new fields.SchemaField({ value: num(value), max: num(max) });

const baseSchema = () => ({
  health: pool(10, 10, 'Health'),
  hits: pool(0, 2, 'Wounds'),
  netHP: pool(20, 20, 'Net HP'),
  bleeding: pool(0, null, 'Bleeding', { withMax: false }),
});

export class MothershipCharacterModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...baseSchema(),
      biography: html(''),
      notes: html(''),
      class: new fields.SchemaField({ value: str('') }),
      pronouns: new fields.SchemaField({ value: str('') }),
      credits: new fields.SchemaField({ value: str('') }),
      // PSG 8-9: both tables print prose, never a document, so the text itself is the record —
      // there is no item for a rolled patch or trinket to arrive as.
      patch: new fields.SchemaField({ value: str('') }),
      trinket: new fields.SchemaField({ value: str('') }),
      attributes: new fields.SchemaField({ level: new fields.SchemaField({ value: num(0) }) }),
      stats: new fields.SchemaField({
        strength: stat(10, 'Strength', 'Strength Check', { mod: true }),
        speed: stat(10, 'Speed', 'Speed Check', { mod: true }),
        intellect: stat(10, 'Intellect', 'Intellect Check', { mod: true }),
        combat: stat(10, 'Combat', 'Combat Check', { mod: true }),
        sanity: stat(10, 'Sanity', 'Sanity Save', { mod: true }),
        fear: stat(10, 'Fear', 'Fear Save', { mod: true }),
        body: stat(10, 'Body', 'Body Save', { mod: true }),
        armor: stat(0, 'Armor', 'Armor Save', { armor: true }),
      }),
      other: new fields.SchemaField({
        stress: pool(2, 20, 'Stress', { min: 2 }),
        stressdesc: new fields.SchemaField({ value: str('') }),
      }),
    };
  }
}

export class MothershipCreatureModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...baseSchema(),
      biography: html(''),
      notes: html(''),
      description: html('This is a description'),
      // PSG 41, "Improving Loyalty": a Contractor is a creature that also tracks Loyalty. That is
      // the only thing a creature can be that changes which stats it carries, so it is one flag
      // and not a row of them.
      contractor: bool(false),
      stats: new fields.SchemaField({
        combat: stat(10, 'Combat', 'Combat Check'),
        instinct: stat(10, 'Instinct', 'Instinct Check'),
        loyalty: stat(10, 'Loyalty', 'Loyalty Check'),
        armor: stat(0, 'Armor', 'Armor Save', { armor: true }),
      }),
      // Stash for the swarm toggle's combat multiplier: must stay in the schema or a
      // SchemaField strips it, making the multiplication permanent instead of reversible.
      swarm: new fields.SchemaField({
        enabled: bool(false),
        combat: new fields.SchemaField({ value: num(0) }),
      }),
    };
  }
}

export const ACTOR_MODELS = {
  character: MothershipCharacterModel,
  creature: MothershipCreatureModel,
};
