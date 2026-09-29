import type { EventStreamFactory } from '../application/conversation/sessionEventsHub';

/**
 * text/event-stream over XMLHttpRequest. React Native's fetch does not
 * stream response bodies, but its XHR delivers `responseText` incrementally
 * through progress events, which is all an SSE reader needs.
 */
export const xhrEventStream: EventStreamFactory = (url, headers, handlers) => {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let closed = false;
  const drain = () => {
    const text = xhr.responseText ?? '';
    if (text.length > seen) {
      handlers.onChunk(text.slice(seen));
      seen = text.length;
    }
  };
  const finish = () => {
    if (closed) return;
    closed = true;
    drain();
    handlers.onClose(xhr.status);
  };
  xhr.open('GET', url);
  for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
  xhr.onprogress = drain;
  xhr.onload = finish;
  xhr.onerror = finish;
  xhr.ontimeout = finish;
  xhr.send();
  return {
    close() {
      closed = true;
      xhr.abort();
    },
  };
};
