/**
 * EnemyProjectile — Enemy projectile that deals damage to the player on hit.
 *
 * Component Attachment: Enemy projectile template root entity
 * Component Networking: Networked
 * Component Ownership: Server (spawned by EnemyShipController on server)
 */
import {component, Vec3} from 'meta/worlds';
import type {Entity} from 'meta/worlds';
import {Projectile} from '../Projectile/Projectile';
import {SpaceShooterDamageReceiver} from './SpaceShooterDamageReceiver';

const ENEMY_PROJECTILE_DAMAGE = 15;

@component({
  description: 'Enemy projectile that deals damage to the player on hit.',
})
export class EnemyProjectile extends Projectile {
  protected override onHit(hitEntity: Entity, position: Vec3, normal: Vec3): void {
    let current: Entity | null = hitEntity;
    while (current) {
      const receiver = current.getComponent(SpaceShooterDamageReceiver);
      if (receiver) {
        receiver.receiveDamage(ENEMY_PROJECTILE_DAMAGE);
        console.log('[EnemyProjectile] Hit player! Dealing damage.');
        return;
      }
      current = current.parent;
    }
  }
}
