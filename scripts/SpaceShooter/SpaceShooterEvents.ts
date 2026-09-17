/**
 * SpaceShooterEvents — Shared events and payloads for the space shooter.
 */
import {NetworkEvent, serializable, property} from 'meta/worlds';

@serializable()
export class SpaceShooterScorePayload {
  @property()
  readonly score: number = 0;
  constructor(score: number = 0) {
    this.score = score;
  }
}

export const OnSpaceShooterScoreChangedEvent = new NetworkEvent(
  'OnSpaceShooterScoreChangedEvent',
  SpaceShooterScorePayload,
);
