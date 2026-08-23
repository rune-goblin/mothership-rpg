import { mount, unmount, type Component } from 'svelte';

import DialogBody from './DialogBody.svelte';

export interface AnswerProps<V> {
  readonly value: V;
  readonly onchange: (value: V) => void;
}

export interface DialogButton<V, T> {
  readonly action: string;
  /** Already localized: this module never guesses at a key. */
  readonly label: string;
  readonly icon?: string;
  readonly class?: string;
  /** DialogV2 autofocuses the button carrying this. */
  readonly default?: boolean;
  readonly answer: (value: V) => T;
}

export interface SvelteDialogOptions<V, T, P extends object> {
  readonly component: Component<P & AnswerProps<V>>;
  readonly props: P;
  readonly title: string;
  readonly initial: V;
  readonly buttons: readonly DialogButton<V, T>[];
  readonly width?: number;
  /** Stands the buttons down the right of the window instead of along its foot; they stay
   *  DialogV2's own `.form-footer` buttons, so `autofocus`/Enter still work. */
  readonly rail?: boolean;
}

interface DialogInstance {
  readonly element: { querySelector(selector: string): Element | null };
  close(): unknown;
}

interface DialogV2Button {
  readonly action: string;
  readonly label: string;
  readonly icon?: string;
  readonly class?: string;
  readonly default?: boolean;
  readonly callback: () => unknown;
}

interface DialogV2Options {
  readonly window: { readonly title: string };
  readonly classes: readonly string[];
  readonly position?: { readonly width: number };
  readonly content: string;
  readonly buttons: readonly DialogV2Button[];
  readonly rejectClose: false;
  readonly render: (event: unknown, dialog: DialogInstance) => void;
  readonly close: (event: unknown, dialog: DialogInstance) => void;
}

declare const foundry:
  | { readonly applications: { readonly api: { readonly DialogV2: { wait(options: DialogV2Options): Promise<unknown> } } } }
  | undefined;

/** `css/mothership.css` styles dialogs by these classes — renaming them needs a CSS change too. */
const CLASSES = ['mothership', 'macro-popup-dialog'] as const;

/** Turns the form's one column into two and stands the footer up as the rail; styled in CSS. */
const RAIL_CLASS = 'macro-popup-rail';

/** A mount point, not a surface: no rule in either stylesheet selects it, so its rename is code. */
const MOUNT_CLASS = 'mothership-dialog-root';

export async function svelteDialog<V, T, P extends object>(
  options: SvelteDialogOptions<V, T, P>,
): Promise<T | null> {
  if (typeof foundry === 'undefined') return null;

  let value = options.initial;
  let component: Record<string, unknown> | null = null;
  let mounted: Element | null = null;

  const answered = await foundry.applications.api.DialogV2.wait({
    window: { title: options.title },
    classes: options.rail === true ? [...CLASSES, RAIL_CLASS] : CLASSES,
    ...(options.width === undefined ? {} : { position: { width: options.width } }),
    content: `<div class="${MOUNT_CLASS}"></div>`,
    buttons: options.buttons.map((button) => ({
      action: button.action,
      label: button.label,
      icon: button.icon,
      class: button.class,
      default: button.default,
      callback: () => ({ answer: button.answer(value) }),
    })),
    rejectClose: false,
    render: (_event, dialog) => {
      const target = dialog.element.querySelector(`.${MOUNT_CLASS}`);
      // ApplicationV2 can re-render into a new node; treat that as a remount, not a second mount,
      // or the component ends up mounted on a detached element and the dialog goes empty.
      if (target === null || target === mounted) return;
      if (component !== null) void unmount(component);

      const props = {
        component: options.component,
        props: options.props,
        initial: value,
        // A body control that finishes the dialog rather than answering it: closing resolves
        // `wait` with null, the same as a dismissal.
        close: () => void dialog.close(),
        report: (next: V) => {
          value = next;
        },
      };
      mounted = target;
      component = mount(DialogBody as Component<typeof props>, { target, props }) as Record<
        string,
        unknown
      >;
    },
    close: () => {
      // Returning anything here would become the dialog's answer, so the unmount is discarded.
      if (component !== null) void unmount(component);
      component = null;
      mounted = null;
    },
  });

  // A button answers with a wrapper, so an answer of `null` stays distinguishable from dismissal.
  return answered === null || answered === undefined ? null : (answered as { answer: T }).answer;
}
