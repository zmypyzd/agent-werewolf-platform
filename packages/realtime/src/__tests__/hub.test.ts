import { describe, it, expect } from 'vitest';
import { RealtimeHub, type HubConnection } from '../hub.js';

class StubConn implements HubConnection {
  readonly userId: string;
  readonly received: string[] = [];
  closed = false;
  failNext = false;
  constructor(userId: string) { this.userId = userId; }
  send(json: string): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('send failure');
    }
    this.received.push(json);
  }
  close(): void { this.closed = true; }
}

describe('RealtimeHub', () => {
  it('subscribe + publish delivers to all subscribers', () => {
    const hub = new RealtimeHub();
    const a = new StubConn('u1');
    const b = new StubConn('u2');
    hub.subscribe(a, 'lobby');
    hub.subscribe(b, 'lobby');
    hub.publishLobby('lobby.table_created', { tableId: 't1' });
    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
    expect(JSON.parse(a.received[0]!)).toMatchObject({
      topic: 'lobby',
      type: 'lobby.table_created',
      payload: { tableId: 't1' },
    });
  });

  it('unsubscribe removes a single topic but keeps others', () => {
    const hub = new RealtimeHub();
    const a = new StubConn('u1');
    hub.subscribe(a, 'lobby');
    hub.subscribe(a, 'table:t1');
    hub.unsubscribe(a, 'lobby');
    hub.publishLobby('x', { v: 1 });
    hub.publishTable('t1', 'y', { v: 2 });
    expect(a.received).toHaveLength(1);
    expect(JSON.parse(a.received[0]!).type).toBe('y');
  });

  it('unsubscribeAll drops the connection from every topic', () => {
    const hub = new RealtimeHub();
    const a = new StubConn('u1');
    hub.subscribe(a, 'lobby');
    hub.subscribe(a, 'table:t1');
    hub.subscribe(a, 'seat:u1:t1');
    hub.unsubscribeAll(a);
    hub.publishLobby('x', {});
    hub.publishTable('t1', 'y', {});
    hub.publishSeat('u1', 't1', 'z', {});
    expect(a.received).toHaveLength(0);
    expect(hub.topicCount('lobby')).toBe(0);
    expect(hub.topicCount('table:t1')).toBe(0);
    expect(hub.topicCount('seat:u1:t1')).toBe(0);
  });

  it('publishSeat reaches only the named user, not the table topic at large', () => {
    const hub = new RealtimeHub();
    const alice = new StubConn('u-alice');
    const bob = new StubConn('u-bob');
    hub.subscribe(alice, 'seat:u-alice:t1');
    hub.subscribe(bob, 'table:t1');
    hub.publishSeat('u-alice', 't1', 'seat.hole_cards', { v: 1 });
    expect(alice.received).toHaveLength(1);
    expect(bob.received).toHaveLength(0);
  });

  it('a sender that throws is dropped from every topic and closed', () => {
    const hub = new RealtimeHub();
    const a = new StubConn('u1');
    hub.subscribe(a, 'lobby');
    hub.subscribe(a, 'table:t1');
    a.failNext = true;
    hub.publishLobby('x', {});
    expect(a.closed).toBe(true);
    expect(hub.topicCount('lobby')).toBe(0);
    expect(hub.topicCount('table:t1')).toBe(0);
  });

  it('publish to an empty topic is a no-op', () => {
    const hub = new RealtimeHub();
    expect(() => hub.publishLobby('x', {})).not.toThrow();
    expect(() => hub.publishTable('nope', 'x', {})).not.toThrow();
  });
});
