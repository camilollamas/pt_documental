import { act } from '@testing-library/react';
import { vi } from 'vitest';

type Listener = (event: MessageEvent<string>) => void;

/** Doble de EventSource (jsdom no lo trae): registra las conexiones y deja emitir eventos SSE. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    act(() => {
      for (const listener of this.listeners[type] ?? []) {
        listener(new MessageEvent(type, { data: JSON.stringify(data) }));
      }
    });
  }

  static install() {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  }

  /** La conexión abierta más reciente. */
  static get last(): FakeEventSource {
    const open = FakeEventSource.instances.filter((s) => !s.closed);
    return open[open.length - 1];
  }
}
