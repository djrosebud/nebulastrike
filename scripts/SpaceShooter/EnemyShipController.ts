/**
 * EnemyShipController — Server-side enemy AI for space shooter.
 *
 * Component Attachment: Enemy ship template root entity
 * Component Networking: Networked
 * Component Ownership: Server (spawned by EnemySpawner on server)
 *
 * Moves toward the player, fires red projectiles periodically, and handles
 * collision with player bullets (destroy + score) and player body (damage + destroy).
 */
import {
  component,
  Component,
  subscribe,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  OnCollisionEnterEvent,
  OnEntityDestroyEvent,
  ExecuteOn,
  TransformComponent,
  Vec3,
  Quaternion,
  WorldService,
  NetworkMode,
  NetworkingService,
  PlayerService,
  BasePlayerComponent,
  TemplateAsset,
  property,
} from 'meta/worlds';
import type {
  Entity,
  Maybe,
  OnWorldUpdateEventPayload,
  OnCollisionEnterEventPayload,
} from 'meta/worlds';
import {Bullet} from '../Projectile/Bullet';
import {SpaceShooterScoreManager} from './SpaceShooterScoreManager';
import {SpaceShooterDamageReceiver} from './SpaceShooterDamageReceiver';

const ENEMY_SPEED = 8;
const FIRE_INTERVAL = 3;
const DAMAGE_TO_PLAYER = 20;
const DESPAWN_DISTANCE = 30;

@component({
  description: 'Enemy ship AI. Attach to enemy ship template root.',
})
export class EnemyShipController extends Component {
  @property()
  enemyProjectileTemplate: Maybe<TemplateAsset> = null;

  private transform: Maybe<TransformComponent> = null;
  private playerEntity: Maybe<Entity> = null;
  private lastFireTime: number = 0;
  private destroyed: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.transform = this.entity.getComponent(TransformComponent);
    const players = PlayerService.get().getAllPlayers();
    if (players.length > 0) {
      this.playerEntity = players[0];
    }
    this.lastFireTime = WorldService.get().getWorldTime();
    console.log('[EnemyShipController] Initialized on server');
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (!this.transform || this.destroyed) return;

    // Re-find player if lost
    if (!this.playerEntity || this.playerEntity.isDestroyed()) {
      const players = PlayerService.get().getAllPlayers();
      this.playerEntity = players.length > 0 ? players[0] : null;
      if (!this.playerEntity) return;
    }

    const playerTransform = this.playerEntity.getComponent(TransformComponent);
    if (!playerTransform) return;

    const dt = payload.deltaTime;
    const pos = this.transform.worldPosition;
    const playerPos = playerTransform.worldPosition;

    // Move toward player
    const dirToPlayer = playerPos.sub(pos);
    const dist = dirToPlayer.magnitude();

    if (dist > 1) {
      const dir = dirToPlayer.normalize();
      this.transform.worldPosition = new Vec3(
        pos.x + dir.x * ENEMY_SPEED * dt,
        pos.y + dir.y * ENEMY_SPEED * dt,
        pos.z + dir.z * ENEMY_SPEED * dt,
      );
      this.transform.worldRotation = Quaternion.lookRotation(dir, Vec3.up);
    }

    // Auto-despawn if passed behind player
    if (pos.z > playerPos.z + DESPAWN_DISTANCE) {
      this.destroyed = true;
      this.entity.destroy();
      return;
    }

    // Periodic firing
    const now = WorldService.get().getWorldTime();
    if (now - this.lastFireTime >= FIRE_INTERVAL && this.enemyProjectileTemplate) {
      this.lastFireTime = now;
      this.fireAtPlayer(playerPos);
    }
  }

  @subscribe(OnCollisionEnterEvent, {execution: ExecuteOn.Everywhere})
  onCollisionEnter(payload: OnCollisionEnterEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (this.destroyed) return;

    const otherEntity = payload.getOtherEntity(this.entity);
    if (!otherEntity) return;

    // Check if hit by player bullet (walk parent chain)
    if (this.findInChain(otherEntity, (e) => e.getComponent(Bullet) != null)) {
      console.log('[EnemyShipController] Hit by player bullet!');
      this.destroyed = true;
      SpaceShooterScoreManager.instance?.addScore(100);
      this.entity.destroy();
      return;
    }

    // Check if collided with player
    if (this.findInChain(otherEntity, (e) => e.getComponent(BasePlayerComponent) != null)) {
      console.log('[EnemyShipController] Collided with player!');
      this.destroyed = true;
      this.dealDamageToPlayer(otherEntity);
      this.entity.destroy();
    }
  }

  private async fireAtPlayer(playerPos: Vec3): Promise<void> {
    if (!this.transform || !this.enemyProjectileTemplate) return;
    const pos = this.transform.worldPosition;
    const dirToPlayer = playerPos.sub(pos).normalize();
    const spawnPos = pos.add(dirToPlayer.mul(3));
    const rotation = Quaternion.lookRotation(dirToPlayer, Vec3.up);

    try {
      await WorldService.get().spawnTemplate({
        templateAsset: this.enemyProjectileTemplate,
        networkMode: NetworkMode.Networked,
        position: spawnPos,
        rotation: rotation,
      });
    } catch (err) {
      console.error('[EnemyShipController] Failed to spawn projectile:', err);
    }
  }

  private findInChain(entity: Entity, predicate: (e: Entity) => boolean): boolean {
    let current: Entity | null = entity;
    while (current) {
      if (predicate(current)) return true;
      current = current.parent;
    }
    return false;
  }

  private dealDamageToPlayer(playerOrChild: Entity): void {
    let current: Entity | null = playerOrChild;
    while (current) {
      const receiver = current.getComponent(SpaceShooterDamageReceiver);
      if (receiver) {
        receiver.receiveDamage(DAMAGE_TO_PLAYER);
        return;
      }
      current = current.parent;
    }
    console.warn('[EnemyShipController] No DamageReceiver found on player chain');
  }
}
