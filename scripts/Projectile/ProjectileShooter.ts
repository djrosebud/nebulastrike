console.log('[ProjectileShooter] Module loading...');

import {
  Component,
  component,
  property,
  subscribe,
  OnEntityStartEvent,
  ExecuteOn,
  WorldService,
  NetworkMode,
  NetworkingService,
  TransformComponent,
  Vec3,
  Quaternion,
  TemplateAsset,
} from 'meta/worlds';
import type { Maybe } from 'meta/worlds';
import { RequestShootEvent, RequestShootPayload } from './ProjectileEvents';
import { Projectile } from './Projectile';

/**
 * Shooter component that spawns and launches projectiles on the SERVER.
 * Attach to the player entity.
 *
 * Component Attachment: Player entity
 * Component Networking: Networked
 * Component Ownership: Client-owned (attached to player, but spawns on server via events)
 *
 * NETWORKING PATTERN:
 * - This component is attached to the player (client-owned)
 * - ShootAction sends RequestShootEvent via entity.sendEventToEveryone when player presses shoot
 * - This component subscribes with ExecuteOn.Everywhere
 * - Only the SERVER actually spawns projectiles (clients can't spawn networked entities)
 *
 * Usage:
 * 1. Attach this component to the player entity
 * 2. Assign the projectile template (must have Projectile component)
 * 3. ShootAction will send RequestShootEvent which this handles
 */
@component()
export class ProjectileShooter extends Component {
  /**
   * Template for the projectile to spawn.
   * Must be created with template_gameplay_object using physics_body_type = "DynamicCollider"
   * and have a Projectile-derived component attached.
   */
  @property()
  projectileTemplate: Maybe<TemplateAsset> = null;

  /** Minimum seconds between shots */
  @property()
  fireRate: number = 0.3;

  /** Offset from entity position to spawn projectile (local space) */
  @property()
  muzzleOffsetX: number = 0;

  @property()
  muzzleOffsetY: number = 0;

  /**
   * ⚠️ MANDATORY: Calculate the appropriate muzzleOffsetZ for this project.
   * The projectile must spawn far enough ahead that a sprinting player cannot
   * reach the spawn zone during the server round-trip.
   *
   * Formula: muzzleOffsetZ = -(maxPlayerSpeed × networkLatency × safetyMultiplier)
   *   - maxPlayerSpeed: fastest player movement speed in m/s for this project
   *   - networkLatency: expected round-trip latency in seconds (typically ~0.2s)
   *   - safetyMultiplier: 3× recommended to account for physics overlap resolution
   *
   * Example: at 8 m/s sprint and ~200ms latency → 8 × 0.2 × 3 = 4.8, round up to -5.0.
   * Adjust if the project uses different move speeds.
   *
   * If the player feels a physical "push" when shooting while running forward,
   * this value is too small — PhysX resolves the collider overlap by shoving
   * the player, even though the script-level collision is ignored. Increase it.
   */
  @property()
  muzzleOffsetZ: number = -5.0;

  private transform: Maybe<TransformComponent> = null;
  private canShoot: boolean = true;
  private lastShootTime: number = 0;

  @subscribe(OnEntityStartEvent, { execution: ExecuteOn.Everywhere })
  onStart(): void {
    this.transform = this.entity.getComponent(TransformComponent);
    const context = NetworkingService.get().isServerContext() ? 'SERVER' : 'CLIENT';
    console.log(`[ProjectileShooter] Initialized on ${context}`);
  }

  /**
   * Server-side handler for shoot requests from clients.
   * When a client presses shoot, they send RequestShootEvent via entity.sendEventToEveryone.
   * This handler runs on BOTH client and server (ExecuteOn.Everywhere),
   * but only the SERVER actually spawns the projectile.
   */
  @subscribe(RequestShootEvent, { execution: ExecuteOn.Everywhere })
  onRequestShoot(payload: RequestShootPayload): void {
    const context = NetworkingService.get().isServerContext() ? 'SERVER' : 'CLIENT';
    console.log(`[ProjectileShooter] Received RequestShootEvent on ${context}`);

    // CRITICAL: Only spawn on the server!
    // Clients cannot spawn NetworkMode.Networked entities
    if (!NetworkingService.get().isServerContext()) {
      console.log('[ProjectileShooter] Ignoring on client - server will handle spawning');
      return;
    }

    console.log('[ProjectileShooter] Server processing spawn request');

    // Check fire rate cooldown (RAPID powerup shortens it)
    const currentTime = WorldService.get().getWorldTime();
    const cooldown = payload.rapidFire ? 0.09 : this.fireRate;
    if (currentTime - this.lastShootTime < cooldown) {
      console.log('[ProjectileShooter] Fire rate cooldown - ignoring shot');
      return;
    }

    if (!this.projectileTemplate) {
      console.log('[ProjectileShooter] No projectile template assigned');
      return;
    }

    // Update last shoot time BEFORE async spawn to prevent multiple spawns
    this.lastShootTime = currentTime;

    // Extract spawn position and aim direction from payload
    const spawnPosition = new Vec3(
      payload.spawnPositionX,
      payload.spawnPositionY,
      payload.spawnPositionZ,
    );

    const aimDirection = new Vec3(
      payload.aimDirectionX,
      payload.aimDirectionY,
      payload.aimDirectionZ,
    ).normalize();

    const pelletCount = Math.max(1, Math.min(5, Math.floor(payload.pelletCount) || 1));
    console.log(`[ProjectileShooter] Spawning ${pelletCount} projectile(s) at (${spawnPosition.x.toFixed(2)}, ${spawnPosition.y.toFixed(2)}, ${spawnPosition.z.toFixed(2)})`);

    // Spawn projectiles on server (async — must await before getComponent)
    for (let i = 0; i < pelletCount; i++) {
      const spreadAngle = (i - (pelletCount - 1) / 2) * 0.18; // ~10 deg yaw per step
      const dir = this.yawRotate(aimDirection, spreadAngle);
      const rotation = Quaternion.lookRotation(dir, Vec3.up);
      this.spawnProjectile(spawnPosition, rotation);
    }
  }

  /** Rotate a direction vector around world Y (for 3-way spread). */
  private yawRotate(dir: Vec3, angle: number): Vec3 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Vec3(
      dir.x * c + dir.z * s,
      dir.y,
      -dir.x * s + dir.z * c,
    ).normalize();
  }

  private async spawnProjectile(spawnPosition: Vec3, rotation: Quaternion): Promise<void> {
    if (!this.projectileTemplate) return;
    try {
      const spawnedEntity = await WorldService.get().spawnTemplate({
        templateAsset: this.projectileTemplate,
        networkMode: NetworkMode.Networked,
        position: spawnPosition,
        rotation: rotation,
      });

      const projectile = spawnedEntity.getComponent(Projectile);
      if (projectile) {
        projectile.setShooter(this.entity);
      } else {
        console.warn('[ProjectileShooter] Spawned entity has no Projectile component');
      }
      console.log('[ProjectileShooter] Projectile spawned');
    } catch (err) {
      console.error('[ProjectileShooter] Spawn failed:', err);
    }
  }
}
