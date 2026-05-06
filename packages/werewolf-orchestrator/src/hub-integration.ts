import {
  type RealtimeHub,
  werewolfMatchTopic,
  werewolfPlayerTopic,
  werewolfReplayEventToPublic,
} from '@agent-poker/realtime';
import type { WerewolfOrchestrator, WerewolfPrivateStateEvent } from './orchestrator.js';

export interface WerewolfPlayerOwnership {
  readonly playerId: string;
  readonly userId: string;
}

export interface AttachWerewolfMatchOptions {
  // No options yet — placeholder for future knobs (e.g. selective filters).
}

export interface WerewolfHubAttachment {
  attachMatch(
    matchId: string,
    ownership: ReadonlyArray<WerewolfPlayerOwnership>,
    options?: AttachWerewolfMatchOptions,
  ): void;
  detachMatch(matchId: string): void;
  detachAll(): void;
}

interface MatchHandle {
  readonly unsubscribeReplay: () => void;
  readonly unsubscribePrivate: () => void;
}

export function attachWerewolfHub(
  orchestrator: WerewolfOrchestrator,
  hub: RealtimeHub,
): WerewolfHubAttachment {
  const handles = new Map<string, MatchHandle>();

  function attachMatch(
    matchId: string,
    ownership: ReadonlyArray<WerewolfPlayerOwnership>,
    _options: AttachWerewolfMatchOptions = {},
  ): void {
    if (handles.has(matchId)) {
      throw new Error(`attachWerewolfHub: match ${matchId} is already attached`);
    }
    const playerToUser = new Map<string, string>();
    for (const o of ownership) {
      playerToUser.set(o.playerId, o.userId);
    }
    const matchTopic = werewolfMatchTopic(matchId);

    const unsubscribeReplay = orchestrator.subscribe(matchId, (event) => {
      const publicEvent = werewolfReplayEventToPublic(event);
      if (publicEvent === null) return;
      hub.publish(matchTopic, {
        topic: matchTopic,
        type: publicEvent.eventType,
        payload: {
          ...publicEvent.data,
          eventId: publicEvent.eventId,
          sequence: publicEvent.sequence,
          timestamp: publicEvent.timestamp,
        },
      });
    });

    // Wire shape for 'werewolf.private_state' (player:<userId>:<gameId> topic):
    //   payload.matchId     — the gameId this snapshot belongs to
    //   payload.playerId    — the in-game player identity (NOT the auth userId);
    //                         needed because a single user could in future control
    //                         multiple seats or join from multiple tabs
    //   payload.privateState — the full WerewolfPrivateState snapshot
    // Players without an entry in the ownership map receive nothing — a no-op,
    // not a fallback topic — so mock-only matches stay silent on player:* topics.
    const unsubscribePrivate = orchestrator.subscribePrivate(matchId, (e: WerewolfPrivateStateEvent) => {
      const userId = playerToUser.get(e.playerId);
      if (!userId) return;
      const playerTopic = werewolfPlayerTopic(userId, matchId);
      hub.publish(playerTopic, {
        topic: playerTopic,
        type: 'werewolf.private_state',
        payload: { matchId, playerId: e.playerId, privateState: e.privateState },
      });
    });

    handles.set(matchId, { unsubscribeReplay, unsubscribePrivate });
  }

  function detachMatch(matchId: string): void {
    const handle = handles.get(matchId);
    if (!handle) return;
    handle.unsubscribeReplay();
    handle.unsubscribePrivate();
    handles.delete(matchId);
  }

  function detachAll(): void {
    for (const matchId of [...handles.keys()]) detachMatch(matchId);
  }

  return { attachMatch, detachMatch, detachAll };
}
