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

@serializable()
export class SpaceShooterShieldPayload {
  @property()
  readonly current: number = 0;
  @property()
  readonly max: number = 0;
  constructor(current: number = 0, max: number = 0) {
    this.current = current;
    this.max = max;
  }
}

export const OnSpaceShooterShieldChangedEvent = new NetworkEvent(
  'OnSpaceShooterShieldChangedEvent',
  SpaceShooterShieldPayload,
);

@serializable()
export class SpaceShooterPowerupPayload {
  @property()
  readonly kind: string = '';
  constructor(kind: string = '') {
    this.kind = kind;
  }
}

export const OnSpaceShooterPowerupCollectedEvent = new NetworkEvent(
  'OnSpaceShooterPowerupCollectedEvent',
  SpaceShooterPowerupPayload,
);

@serializable()
export class SpaceShooterKillPayload {
  @property()
  readonly posX: number = 0;
  @property()
  readonly posY: number = 0;
  @property()
  readonly posZ: number = 0;
  @property()
  readonly boss: boolean = false;
  constructor(posX: number = 0, posY: number = 0, posZ: number = 0, boss: boolean = false) {
    this.posX = posX;
    this.posY = posY;
    this.posZ = posZ;
    this.boss = boss;
  }
}

export const OnSpaceShooterEnemyKilledEvent = new NetworkEvent(
  'OnSpaceShooterEnemyKilledEvent',
  SpaceShooterKillPayload,
);
