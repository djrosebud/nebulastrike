console.log('[ProjectileEvents] Module loading...');

import {
  NetworkEvent,
  serializable,
  property,
} from 'meta/worlds';

/**
 * Payload for the RequestShootEvent containing the aim direction and spawn position.
 *
 * This is defined in a separate file to avoid circular dependencies between
 * Projectile and ProjectileShooter scripts.
 */
@serializable()
export class RequestShootPayload {
  @property()
  public readonly spawnPositionX: number;

  @property()
  public readonly spawnPositionY: number;

  @property()
  public readonly spawnPositionZ: number;

  @property()
  public readonly aimDirectionX: number;

  @property()
  public readonly aimDirectionY: number;

  @property()
  public readonly aimDirectionZ: number;

  constructor(
    spawnPositionX: number = 0,
    spawnPositionY: number = 0,
    spawnPositionZ: number = 0,
    aimDirectionX: number = 0,
    aimDirectionY: number = 0,
    aimDirectionZ: number = -1
  ) {
    this.spawnPositionX = spawnPositionX;
    this.spawnPositionY = spawnPositionY;
    this.spawnPositionZ = spawnPositionZ;
    this.aimDirectionX = aimDirectionX;
    this.aimDirectionY = aimDirectionY;
    this.aimDirectionZ = aimDirectionZ;
  }
}

/**
 * Event sent from the shooting client to the server to request projectile spawning.
 * The server spawns the projectile authoritatively so it is visible to all clients.
 *
 * This is defined in a separate file to avoid circular dependencies between
 * Projectile and ProjectileShooter scripts.
 */
export const RequestShootEvent = new NetworkEvent(
  'RequestShootEvent',
  RequestShootPayload,
);
