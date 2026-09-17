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

@serializable()
export class SpaceShooterWavePayload {
  @property()
  readonly wave: number = 0;
  @property()
  readonly totalWaves: number = 0;
  constructor(wave: number = 0, totalWaves: number = 0) {
    this.wave = wave;
    this.totalWaves = totalWaves;
  }
}

export const OnSpaceShooterWaveChangedEvent = new NetworkEvent(
  'OnSpaceShooterWaveChangedEvent',
  SpaceShooterWavePayload,
);

export const OnSpaceShooterVictoryEvent = new NetworkEvent(
  'OnSpaceShooterVictoryEvent',
  SpaceShooterScorePayload,
);
