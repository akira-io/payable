import { InvalidStateTransitionError } from '../errors/invalid-state-transition.error';

export type TransitionMap<S extends string, E extends string> = Partial<
  Record<S, Partial<Record<E, S>>>
>;

export function applyTransition<S extends string, E extends string>(
  machine: string,
  map: TransitionMap<S, E>,
  from: S,
  event: E,
): S {
  const next = map[from]?.[event];
  if (next === undefined) {
    throw new InvalidStateTransitionError(machine, from, event);
  }
  return next;
}

export function canTransition<S extends string, E extends string>(
  map: TransitionMap<S, E>,
  from: S,
  event: E,
): boolean {
  return map[from]?.[event] !== undefined;
}
