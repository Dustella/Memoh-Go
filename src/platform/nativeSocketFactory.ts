import type { SocketFactory, SocketLike } from '../data/remote/runtimeSocket';

/**
 * React Native's WebSocket accepts a third `{ headers }` argument, so the
 * token travels in `Authorization` rather than the URL (contracts/runtime-ws.md).
 */
type RNWebSocketCtor = new (
  url: string,
  protocols: string[] | undefined,
  options: { headers: Record<string, string> },
) => SocketLike;

export const nativeSocketFactory: SocketFactory = (url, token) => {
  const Ctor = WebSocket as unknown as RNWebSocketCtor;
  return new Ctor(url, undefined, { headers: { Authorization: `Bearer ${token}` } });
};
