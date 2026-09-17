/**
 * EnemyShipController — Server-side enemy AI for space shooter.
 *
 * Component Attachment: Enemy ship template root entity
 * Component Networking: Networked
 * Component Ownership: Server (spawned by EnemySpawner on server)
 *
 * Moves toward the player with a sine-drift weave, fires projectiles
 * periodically, and handles collision with player bullets (HP damage +
 * score) and player body (damage + destroy, except the boss).
 *
 * The wave-3 boss is the same template promoted via configureAsBoss():
 * high HP, slower, radial orb bursts. The spawner scales it up 3x.
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
import {EnemyProjectile} from './EnemyProjectile';
import {
  OnSpaceShooterEnemyKilledEvent,
  SpaceShooterKillPayload,
} from './SpaceShooterEvents';

const DAMAGE_TO_PLAYER = 20;
const DESPAWN_DISTANCE = 30;
const BOSS_HP = 40;
const BOSS_SPEED = 4.5;
const BOSS_FIRE_INTERVAL = 2.5;
const BOSS_RADIAL_COUNT = 12;
const BOSS_SCORE = 1000;
const DEATH_POP_TIME = 0.28;

@component({
  description: 'Enemy ship AI. Attach to enemy ship template root.',
})
export class EnemyShipController extends Component {
  @property()
  enemyProjectileTemplate: Maybe<TemplateAsset> = null;

  /** Tuned per-wave by EnemySpawner right after spawn. */
  @property()
  hitPoints: number = 1;
  @property()
  moveSpeed: number = 8;
  @property()
  fireInterval: number = 3;
  @property()
  scoreValue: number = 100;
  @property()
  driftAmplitude: number = 2.0;
  @property()
  driftFrequency: number = 1.5;

  /** Per-wave projectile damage, tuned by EnemySpawner right after spawn. */
  @property()
  projectileDamage: number = 15;

  private transform: Maybe<TransformComponent> = null;
  private playerEntity: Maybe<Entity> = null;
  private lastFireTime: number = 0;
  private destroyed: boolean = false;
  private dying: boolean = false;
  private deathT: number = 0;
  private driftPhase: number = 0;
  private isBoss: boolean = false;
  private radialCount: number = 0;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.transform = this.entity.getComponent(TransformComponent);
    const players = PlayerService.get().getAllPlayers();
    if (players.length > 0) {
      this.playerEntity = players[0];
    }
    this.lastFireTime = WorldService.get().getWorldTime();
    this.driftPhase = Math.random() * Math.PI * 2;
    console.log('[EnemyShipController] Initialized on server');
  }

  /**
   * Promote this drone into the wave-3 boss. Called by EnemySpawner
   * immediately after spawn; the spawner also scales the entity up.
   */
  public configureAsBoss(): void {
    this.isBoss = true;
    this.hitPoints = BOSS_HP;
    this.moveSpeed = BOSS_SPEED;
    this.fireInterval = BOSS_FIRE_INTERVAL;
    this.scoreValue = BOSS_SCORE;
    this.radialCount = BOSS_RADIAL_COUNT;
    this.driftAmplitude = 1.0;
    console.log('[EnemyShipController] Configured as BOSS');
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (!this.transform) return;

    const dt = payload.deltaTime;

    // Death pop: scale up and rise briefly, then destroy
    if (this.dying) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / DEATH_POP_TIME);
      const s = 1 + t * 1.4;
      this.transform.worldScale = new Vec3(s, s, s);
      const pos = this.transform.worldPosition;
      this.transform.worldPosition = new Vec3(pos.x, pos.y + dt * 3, pos.z);
      if (this.deathT >= DEATH_POP_TIME) {
        this.entity.destroy();
      }
      return;
    }
    if (this.destroyed) return;

    // Re-find player if lost
    if (!this.playerEntity || this.playerEntity.isDestroyed()) {
      const players = PlayerService.get().getAllPlayers();
      this.playerEntity = players.length > 0 ? players[0] : null;
      if (!this.playerEntity) return;
    }

    const playerTransform = this.playerEntity.getComponent(TransformComponent);
    if (!playerTransform) return;

    const pos = this.transform.worldPosition;
    const playerPos = playerTransform.worldPosition;

    // Move toward player with a horizontal sine-drift weave
    const dirToPlayer = playerPos.sub(pos);
    const dist = dirToPlayer.magnitude();

    if (dist > 1) {
      const dir = dirToPlayer.normalize();
      this.driftPhase += dt * this.driftFrequency;
      // Perpendicular to travel direction (horizontal): cross(dir, up) = (-dir.z, 0, dir.x)
      const px = -dir.z;
      const pz = dir.x;
      const perpLen = Math.sqrt(px * px + pz * pz);
      let driftX = 0;
      let driftZ = 0;
      if (perpLen > 0.0001) {
        const w = (Math.sin(this.driftPhase) * this.driftAmplitude) / perpLen;
        driftX = px * w;
        driftZ = pz * w;
      }
      this.transform.worldPosition = new Vec3(
        pos.x + (dir.x * this.moveSpeed + driftX) * dt,
        pos.y + dir.y * this.moveSpeed * dt,
        pos.z + (dir.z * this.moveSpeed + driftZ) * dt,
      );
      this.transform.worldRotation = Quaternion.lookRotation(dir, Vec3.up);
    }

    // Auto-despawn if passed behind player
    if (pos.z > playerPos.z + DESPAWN_DISTANCE) {
      this.destroyed = true;
      this.entity.destroy();
      return;
    }

    // Periodic firing: aimed shot, or radial burst for the boss
    const now = WorldService.get().getWorldTime();
    if (now - this.lastFireTime >= this.fireInterval && this.enemyProjectileTemplate) {
      this.lastFireTime = now;
      if (this.radialCount > 0) {
        void this.fireRadial(playerPos);
      } else {
        void this.fireAtPlayer(playerPos);
      }
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
      this.hitPoints -= 1;
      if (this.hitPoints <= 0) {
        this.startDeathPop();
      } else {
        console.log(
          `[EnemyShipController] Hit! HP remaining: ${this.hitPoints}`,
        );
      }
      return;
    }

    // Check if collided with player
    if (this.findInChain(otherEntity, (e) => e.getComponent(BasePlayerComponent) != null)) {
      console.log('[EnemyShipController] Collided with player!');
      this.dealDamageToPlayer(otherEntity);
      // Drones die on ramming; the boss plows through
      if (!this.isBoss) {
        this.startDeathPop();
      }
    }
  }

  /** Score + kill event + death-pop animation (destroy deferred). */
  private startDeathPop(): void {
    if (this.dying) return;
    this.dying = true;
    this.destroyed = true;
    this.deathT = 0;
    console.log(
      `[EnemyShipController] ${this.isBoss ? 'BOSS' : 'Drone'} destroyed! +${this.scoreValue}`,
    );
    SpaceShooterScoreManager.instance?.addScore(this.scoreValue);
    const pos = this.transform?.worldPosition ?? new Vec3(0, 5, -10);
    this.entity.sendEventToEveryone(
      OnSpaceShooterEnemyKilledEvent,
      new SpaceShooterKillPayload(pos.x, pos.y, pos.z, this.isBoss),
    );
  }

  private async fireAtPlayer(playerPos: Vec3): Promise<void> {
    if (!this.transform || !this.enemyProjectileTemplate) return;
    const pos = this.transform.worldPosition;
    const dirToPlayer = playerPos.sub(pos).normalize();
    const spawnPos = pos.add(dirToPlayer.mul(3));
    const rotation = Quaternion.lookRotation(dirToPlayer, Vec3.up);

    try {
      const spawned = await WorldService.get().spawnTemplate({
        templateAsset: this.enemyProjectileTemplate,
        networkMode: NetworkMode.Networked,
        position: spawnPos,
        rotation: rotation,
      });
      spawned.getComponent(EnemyProjectile)?.setDamage(this.projectileDamage);
    } catch (err) {
      console.error('[EnemyShipController] Failed to spawn projectile:', err);
    }
  }

  private async fireRadial(playerPos: Vec3): Promise<void> {
    if (!this.transform || !this.enemyProjectileTemplate) return;
    const pos = this.transform.worldPosition;
    const dir = playerPos.sub(pos).normalize();

    // Orthonormal basis perpendicular to the aim direction
    let ux = -dir.z;
    let uy = 0;
    let uz = dir.x;
    const ulen = Math.sqrt(ux * ux + uz * uz);
    if (ulen < 0.0001) {
      ux = 1;
      uy = 0;
      uz = 0;
    } else {
      ux /= ulen;
      uz /= ulen;
    }
    // v = dir x u
    const vx = dir.y * uz - dir.z * uy;
    const vy = dir.z * ux - dir.x * uz;
    const vz = dir.x * uy - dir.y * ux;

    for (let i = 0; i < this.radialCount; i++) {
      const a = (i / this.radialCount) * Math.PI * 2;
      const d = new Vec3(
        ux * Math.cos(a) + vx * Math.sin(a),
        uy * Math.cos(a) + vy * Math.sin(a),
        uz * Math.cos(a) + vz * Math.sin(a),
      ).normalize();
      const spawnPos = pos.add(d.mul(4));
      const rotation = Quaternion.lookRotation(d, Vec3.up);
      try {
        const spawned = await WorldService.get().spawnTemplate({
          templateAsset: this.enemyProjectileTemplate,
          networkMode: NetworkMode.Networked,
          position: spawnPos,
          rotation: rotation,
        });
        spawned.getComponent(EnemyProjectile)?.setDamage(this.projectileDamage);
      } catch (err) {
        console.error('[EnemyShipController] Boss radial fire failed:', err);
        return;
      }
    }
    console.log(`[EnemyShipController] Boss radial burst x${this.radialCount}`);
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
