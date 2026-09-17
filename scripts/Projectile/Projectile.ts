console.log('[Projectile] Module loading...');

import {
  Component,
  component,
  property,
  subscribe,
  OnEntityStartEvent,
  OnCollisionEnterEvent,
  OnCollisionEnterEventPayload,
  ExecuteOn,
  PhysicsBodyComponent,
  TransformComponent,
  Vec3,
} from 'meta/worlds';
import type { Entity, Maybe } from 'meta/worlds';

/**
 * Base projectile component that flies forward using physics velocity and
 * destroys itself on collision or after a lifetime timeout.
 *
 * Component Attachment: Projectile template root entity
 * Component Networking: Networked (server-owned when spawned by server)
 * Component Ownership: Server (spawned by ProjectileShooter on server)
 *
 * On start, sets linearVelocity to the entity's forward direction x speed.
 * PhysX handles flight trajectory and collision with DynamicCollider targets
 * automatically — no manual movement code needed.
 *
 * Extend this class and override onHit() for custom hit effects (damage, VFX, sound).
 *
 * Requirements:
 * - Entity must be spawned dynamically (needs destruction on hit/timeout)
 * - Root entity must have PhysicsBodyComponent with type = DynamicCollider
 * - Template must have a primitive collider (sphere recommended for projectiles)
 * - Spawned with correct rotation so forward (-Z) points in aim direction
 */
@component()
export class Projectile extends Component {
  /** Projectile speed in m/s */
  @property()
  speed: number = 30;

  /** Seconds before auto-destroy (prevents orphaned projectiles) */
  @property()
  lifetime: number = 5;

  /** Whether gravity affects the projectile (false = straight line, true = arc) */
  @property()
  useGravity: boolean = false;

  /**
   * ⚠️ MANDATORY: Set CLEARANCE_DISTANCE and MAX_PLAYER_SPEED to match this project.
   * - CLEARANCE_DISTANCE must equal the absolute value of ProjectileShooter.muzzleOffsetZ
   * - MAX_PLAYER_SPEED must equal the project's fastest player movement speed in m/s
   * These drive the speed-adaptive immunity window calculation below.
   */
  private static readonly CLEARANCE_DISTANCE = 5.0;
  private static readonly SAFETY_MULTIPLIER = 2.0;
  private static readonly MIN_IMMUNITY_MS = 200;
  private static readonly MAX_PLAYER_SPEED = 12.0;

  private physicsBody: Maybe<PhysicsBodyComponent> = null;
  private hasHit: boolean = false;
  private firedBy: Maybe<Entity> = null;
  private spawnTime: number = 0;
  private immunityMs: number = Projectile.MIN_IMMUNITY_MS;

  /**
   * Stores the shooter entity so the collision-level guard can skip self-hits.
   * Called by ProjectileShooter immediately after spawnTemplate() — this is
   * the primary mechanism for shooter identity. Must be called before the
   * immunity window expires.
   */
  public setShooter(shooter: Entity): void {
    this.firedBy = shooter;
  }

  /**
   * Walks up the entity parent chain to check if `entity` is `target` or a
   * child of `target`. Required because the physics engine reports collisions
   * with child entities (e.g., the player's "Collider" child), not the root
   * entity passed to setShooter().
   *
   * This is the same pattern used by the Ouro Multiplayer Shooter ECS
   * (GameplayUtils.isEntityOrParent) for robust shooter-ignore filtering.
   */
  private isEntityOrParent(entity: Entity, target: Maybe<Entity>): boolean {
    if (!target) return false;
    let current: Entity | null = entity;
    while (current) {
      if (current === target) return true;
      current = current.parent;
    }
    return false;
  }

  @subscribe(OnEntityStartEvent, { execution: ExecuteOn.Owner })
  onStart(): void {
    this.physicsBody = this.entity.getComponent(PhysicsBodyComponent);
    if (!this.physicsBody) {
      console.warn('Projectile: No PhysicsBodyComponent found');
      return;
    }

    this.physicsBody.isAffectedByGravity = this.useGravity;
    // Enable CCD by default so fast projectiles don't tunnel through player colliders.
    // Subclasses can opt out by setting continuousCollisionDetection = false after super.onStart().
    this.physicsBody.continuousCollisionDetection = true;
    this.spawnTime = Date.now();

    // Compute immunity window
    // 1. Fast projectile (speed > player sprint): time to clear the spawn offset
    // 2. Slow projectile (speed <= player sprint): time for player to catch up
    //    and pass through the clearance gap, so the bullet is always ahead
    let immunitySeconds: number;
    if (this.speed > Projectile.MAX_PLAYER_SPEED) {
      immunitySeconds = (Projectile.CLEARANCE_DISTANCE / this.speed) * Projectile.SAFETY_MULTIPLIER;
    } else {
      // Slow projectile: player can catch up. Immunity must last until the
      // bullet is beyond the player's reach. Formula: gap / closing speed.
      const closingSpeed = Math.max(0.1, Projectile.MAX_PLAYER_SPEED - this.speed);
      immunitySeconds = (Projectile.CLEARANCE_DISTANCE / closingSpeed) * Projectile.SAFETY_MULTIPLIER;
    }
    this.immunityMs = Math.max(Projectile.MIN_IMMUNITY_MS, immunitySeconds * 1000);
    console.log(`[Projectile] Immunity window: ${this.immunityMs.toFixed(0)}ms (speed: ${this.speed} m/s)`);

    // Launch in entity's forward direction (-Z in MHS coordinate system)
    const transform = this.entity.getComponent(TransformComponent);
    if (transform) {
      // CRITICAL FIX: Use instance method transform.worldRotation.mulVec3(Vec3.forward)
      // instead of static Quaternion.mulVec3(Vec3.forward, transform.worldRotation)
      // The static method has different argument order: mulVec3(vec, rotation)
      // But using the instance method is clearer and less error-prone.
      const forward = transform.worldRotation.mulVec3(Vec3.forward);
      this.physicsBody.linearVelocity = new Vec3(
        forward.x * this.speed,
        forward.y * this.speed,
        forward.z * this.speed,
      );
    }

    // Auto-destroy after lifetime
    setTimeout(() => {
      if (this.entity?.valid) {
        this.entity.destroy();
      }
    }, this.lifetime * 1000);
  }

  /**
   * Handles collision with other physics objects.
   * Calls onHit() for custom effects, then destroys the projectile.
   */
  @subscribe(OnCollisionEnterEvent, { execution: ExecuteOn.Owner })
  onCollisionEnter(payload: OnCollisionEnterEventPayload): void {
    if (this.hasHit) return;

    // LAYER 2: Immunity window — ignore ALL collisions for the first 200ms.
    // Catches spawn overlap, physics settling, and async setShooter() race.
    const elapsed = Date.now() - this.spawnTime;
    if (elapsed < this.immunityMs) {
      console.log(`[Projectile] Collision ignored — immunity window (${elapsed}ms < ${this.immunityMs}ms)`);
      return;
    }

    const otherEntity = payload.getOtherEntity(this.entity);

    // LAYER 3: Entity parent-chain check — walk up because physics reports
    // collisions with CHILD entities (e.g., the player's "Collider" child),
    // not the root entity passed to setShooter().
    if (otherEntity && this.isEntityOrParent(otherEntity, this.firedBy)) {
      console.log('[Projectile] Skipping self-hit via parent-chain');
      return;
    }

    this.hasHit = true;
    console.log(`[Projectile] Hit confirmed — destroying projectile`);

    if (otherEntity?.valid) {
      this.onHit(otherEntity, payload.position, payload.normalBToA);
    }

    // Destroy projectile on hit
    if (this.entity?.valid) {
      this.entity.destroy();
    }
  }

  /**
   * Override to implement custom hit effects.
   * Called on the owner (server) when the projectile collides with another entity.
   *
   * @param hitEntity The entity that was hit
   * @param position World position of the collision point
   * @param normal Collision surface normal
   *
   * Common patterns:
   * - Apply damage: hitEntity.getComponent(HealthComponent)?.takeDamage(10)
   * - Apply knockback: hitEntity.getComponent(PhysicsBodyComponent)?.applyImpulse(knockback)
   * - Spawn VFX at position
   */
  protected onHit(hitEntity: Entity, position: Vec3, normal: Vec3): void {
    // Override in subclass for custom hit effects
  }
}
