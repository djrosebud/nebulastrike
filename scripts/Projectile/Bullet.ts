console.log('[Bullet] Module loading...');

import {
  component,
  Vec3,
} from 'meta/worlds';
import type { Entity } from 'meta/worlds';
import { Projectile } from './Projectile';

/**
 * Bullet projectile that extends the base Projectile class.
 * A simple, fast-moving projectile that destroys itself on impact.
 *
 * Component Attachment: Bullet template root entity (Templates/GameplayObjects/Bullet.hstf)
 * Component Networking: Networked (server-owned when spawned by ProjectileShooter)
 * Component Ownership: Server
 *
 * The base Projectile class handles:
 * - Physics-based flight using linearVelocity
 * - Collision detection and auto-destroy on hit
 * - Lifetime timeout to prevent orphaned projectiles
 *
 * Override onHit() here for bullet-specific effects like damage or VFX.
 */
@component()
export class Bullet extends Projectile {
  /**
   * Called when the bullet hits an entity.
   * Override to add damage, VFX, or other hit effects.
   *
   * @param hitEntity The entity that was hit
   * @param position World position of the collision point
   * @param normal Collision surface normal (pointing toward bullet)
   */
  protected override onHit(hitEntity: Entity, position: Vec3, normal: Vec3): void {
    console.log(`[Bullet] Hit entity at position (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);

    // Future: Add damage application here
    // const health = hitEntity.getComponent(HealthComponent);
    // if (health) {
    //   health.takeDamage(this.damage);
    // }

    // Future: Spawn hit VFX here
    // WorldService.get().spawnTemplate({
    //   templateAsset: this.hitVfxTemplate,
    //   position: position,
    //   networkMode: NetworkMode.LocalOnly,
    // });
  }
}
