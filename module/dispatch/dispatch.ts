/**
 * One socket pipeline, so work a player may not do themselves is done by the Warden's client on
 * their behalf. Modelled on pf2e-reignmaker's ActionDispatcher; the parts that matter are the
 * request/reply correlation, the single executing GM, and the timeout.
 *
 * Foundry's socket is broadcast-only — there is no point-to-point send — so a reply goes to
 * everybody and carries the id of the client meant to read it.
 *
 * Nothing here decides whether a request is *allowed*. A handler is running with the Warden's
 * permissions, so it authorizes its own sender; `checks/harm.ts` is the worked example.
 */

import { SYSTEM_ID } from '../chat/cards.ts';
import { debug } from '../debug.ts';

const CHANNEL = `system.${SYSTEM_ID}`;

/** Long enough to cover a GM client busy with a scene load, short enough that a button un-sticks. */
const TIMEOUT_MS = 10_000;

export type DispatchAction = 'harm' | 'wound';

export type DispatchHandler = (data: unknown, senderId: string) => Promise<unknown>;

interface RequestMessage {
  readonly kind: 'request';
  readonly action: DispatchAction;
  readonly data: unknown;
  readonly senderId: string;
  readonly requestId: string;
}

interface ReplyMessage {
  readonly kind: 'result' | 'error';
  readonly action: DispatchAction;
  readonly data: unknown;
  readonly requestId: string;
  readonly targetId: string;
}

type SocketMessage = RequestMessage | ReplyMessage;

interface SocketUser {
  readonly id?: string;
  readonly isGM?: boolean;
  readonly active?: boolean;
}

declare const game:
  | {
      readonly user?: SocketUser;
      readonly users?: { get(id: string): SocketUser | undefined; readonly activeGM?: SocketUser | null };
      readonly socket?: {
        on(channel: string, handler: (message: unknown) => void): void;
        emit(channel: string, message: unknown): void;
      };
    }
  | undefined;

declare const foundry: { readonly utils: { randomID(): string } } | undefined;

/**
 * `ran` carries whatever the handler returned. The rest are answers, not exceptions — a caller that
 * can do the work itself reads `no-gm` and gets on with it.
 */
export type Dispatched<T> =
  | { readonly kind: 'ran'; readonly result: T }
  | { readonly kind: 'no-gm' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed'; readonly reason: string };

const HANDLERS = new Map<DispatchAction, DispatchHandler>();

interface Pending {
  readonly resolve: (value: Dispatched<unknown>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const PENDING = new Map<string, Pending>();

let listening = false;

export function registerDispatch(action: DispatchAction, handler: DispatchHandler): void {
  HANDLERS.set(action, handler);
}

/** Test seam: the socket listener is bound once for the module's lifetime, the handlers are not. */
export function clearDispatch(): void {
  HANDLERS.clear();
  for (const pending of PENDING.values()) clearTimeout(pending.timer);
  PENDING.clear();
}

function userId(): string {
  return game?.user?.id ?? '';
}

/**
 * Only the one GM Foundry names `activeGM` executes. Every GM client receives the request, and
 * without this each would apply the damage.
 */
function isPrimaryGM(): boolean {
  const active = game?.users?.activeGM?.id;
  return active !== undefined && active !== null && active === userId();
}

function gmOnline(): boolean {
  return (game?.users?.activeGM ?? null) !== null;
}

function emit(message: SocketMessage): void {
  game?.socket?.emit(CHANNEL, message);
}

async function run(action: DispatchAction, data: unknown, senderId: string): Promise<Dispatched<unknown>> {
  const handler = HANDLERS.get(action);
  if (handler === undefined) return { kind: 'failed', reason: `no handler for ${action}` };

  // A request naming a user who is not connected is not a request this client can vouch for.
  if (senderId !== userId() && game?.users?.get(senderId)?.active !== true) {
    return { kind: 'failed', reason: 'unknown sender' };
  }

  try {
    return { kind: 'ran', result: await handler(data, senderId) };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

function onRequest(message: RequestMessage): void {
  if (!isPrimaryGM()) return;

  void run(message.action, message.data, message.senderId).then((outcome) => {
    emit({
      kind: outcome.kind === 'ran' ? 'result' : 'error',
      action: message.action,
      data: outcome.kind === 'ran' ? outcome.result : { reason: outcome.kind === 'failed' ? outcome.reason : outcome.kind },
      requestId: message.requestId,
      targetId: message.senderId,
    });
  });
}

function onReply(message: ReplyMessage): void {
  if (message.targetId !== userId()) return;

  const pending = PENDING.get(message.requestId);
  if (pending === undefined) return;
  PENDING.delete(message.requestId);
  clearTimeout(pending.timer);

  const reason = (message.data as { reason?: unknown })?.reason;
  pending.resolve(
    message.kind === 'result'
      ? { kind: 'ran', result: message.data }
      : { kind: 'failed', reason: typeof reason === 'string' ? reason : 'the Warden’s client refused it' },
  );
}

function onSocket(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return;
  const message = raw as SocketMessage;
  if (message.kind === 'request') return onRequest(message);
  if (message.kind === 'result' || message.kind === 'error') return onReply(message);
}

export function initDispatch(): void {
  if (listening || game?.socket === undefined) return;
  game.socket.on(CHANNEL, onSocket);
  listening = true;
}

function requestId(): string {
  return typeof foundry === 'undefined' ? `${PENDING.size}-${Date.now()}` : foundry.utils.randomID();
}

async function sendToGM(action: DispatchAction, data: unknown): Promise<Dispatched<unknown>> {
  const id = requestId();

  return await new Promise<Dispatched<unknown>>((resolve) => {
    const timer = setTimeout(() => {
      if (PENDING.delete(id)) resolve({ kind: 'timeout' });
    }, TIMEOUT_MS);

    PENDING.set(id, { resolve, timer });
    emit({ kind: 'request', action, data, senderId: userId(), requestId: id });
  });
}

/** The Warden runs it here and now; everybody else asks the Warden's client to. */
export async function dispatch<T>(action: DispatchAction, data: unknown): Promise<Dispatched<T>> {
  debug('dispatch', `${action} ${isPrimaryGM() ? 'locally' : 'to the Warden'}`);

  if (isPrimaryGM()) return (await run(action, data, userId())) as Dispatched<T>;
  if (!gmOnline()) return { kind: 'no-gm' };
  return (await sendToGM(action, data)) as Dispatched<T>;
}
