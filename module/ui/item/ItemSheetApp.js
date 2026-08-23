import { mount, unmount } from 'svelte';
import ItemSheet from './ItemSheet.svelte';
import { itemContext } from './forms.js';
import { createDocumentStore } from '../document-store.svelte.js';

const { DocumentSheetV2 } = foundry.applications.api;

/**
 * Fields keep `name="system.…"` attributes; Foundry's form handling (submitOnChange) persists
 * them — no per-field update calls needed.
 */
export class MothershipItemSheet extends DocumentSheetV2 {
  static COMPONENT = ItemSheet;

  static DEFAULT_OPTIONS = {
    // css/mothership.css paints the content white and has no dark variant, so pin the light theme.
    // DocumentSheetV2 only appends the user's theme classes when "themed" is not already here.
    classes: ['mothership', 'sheet', 'item', 'themed', 'theme-light'],
    position: { width: 600, height: 500 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
  };

  /** Title the window with the bare item name, not Foundry's default sheet title. */
  get title() {
    return this.document.name;
  }

  #component;
  #root;
  #store;

  _context() {
    return itemContext(this.document);
  }

  /** Mount once; re-render refreshes the store instead, so Svelte state isn't discarded. */
  async _renderHTML() {
    const context = await this._context();
    if (this.#component) {
      this.#store.refresh(context);
      return this.#root;
    }
    this.#store = createDocumentStore(this.document, context);
    this.#root = document.createElement('div');
    this.#root.className = 'mothership-sheet-root';
    this.#component = mount(this.constructor.COMPONENT, {
      target: this.#root,
      props: { store: this.#store, app: this },
    });
    return this.#root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  async _preClose(options) {
    await super._preClose(options);
    if (!this.#component) return;
    unmount(this.#component);
    this.#component = undefined;
    this.#root = undefined;
    this.#store = undefined;
  }
}
