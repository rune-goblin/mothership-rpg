// Foundry documents aren't reactive: refresh() re-reads a fresh snapshot on each render, so the
// document stays the source of truth and nothing is mirrored into local state. `extra` carries
// data the shell computed asynchronously, e.g. enriched HTML.
export function createDocumentStore(document, extra = {}) {
  const read = (more) => ({
    id: document.id,
    uuid: document.uuid,
    type: document.type,
    name: document.name,
    img: document.img,
    system: document.system,
    ...more,
  });

  let snapshot = $state.raw(read(extra));

  return {
    get current() {
      return snapshot;
    },
    get document() {
      return document;
    },
    refresh(more = {}) {
      snapshot = read(more);
    },
  };
}

// A path walker rather than foundry.utils.mergeObject: the draft is plain data with no schema
// behind it, so there is nothing here Foundry's version would do differently.
function setPath(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = target;
  for (const key of keys) node = node[key] ??= {};
  node[last] = value;
}

/**
 * The same shape over an item no document holds yet. `update` writes into the draft instead of
 * the database, so a body that edits a list — Weapon's damage modes, SkillSheet's prerequisites —
 * works here unchanged. `blank` is what `context` derives for an empty draft, which is knowable
 * without running it — the store has to hand out a first snapshot before any await.
 */
export function createDraftStore(source, context, blank) {
  const draft = structuredClone(source);

  const read = (more) => ({
    id: null,
    uuid: null,
    type: draft.type,
    name: draft.name,
    img: draft.img,
    system: draft.system,
    ...more,
  });

  const document = {
    uuid: null,
    get name() {
      return draft.name;
    },
    get type() {
      return draft.type;
    },
    get img() {
      return draft.img;
    },
    get system() {
      return draft.system;
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) setPath(draft, path, value);
      await refresh();
    },
  };

  let snapshot = $state.raw(read(blank));

  async function refresh() {
    snapshot = read(await context(document));
  }

  return {
    get current() {
      return snapshot;
    },
    get document() {
      return document;
    },
    /** What `Item.create` is handed. */
    source: () => structuredClone(draft),
    refresh,
  };
}
