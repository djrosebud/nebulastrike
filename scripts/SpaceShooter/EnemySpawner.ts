/**
 * EnemySpawner — Server-side enemy spawner.
 *
 * Component Attachment: Scene entity (server-owned)
 * Component Networking: Networked
 * Component Ownership: Server
 *
 * Spawns enemy ships at regular intervals at random X/Y positions ahead
 * of the player on the -Z axis.
 */
import {
  component,
  Component,
  subscribe,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  OnPlayerCreateEvent,
  OnPlayerCreateEventPayload,
  ExecuteOn,
  WorldService,
  NetworkMode,
  NetworkingService,
  TransformComponent,
  Vec3,
  Quaternion,
  PlayerService,
  TemplateAsset,
  property,
} from 'meta/worlds';
import type {Entity, Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';

const SPAWN_INTERVAL = 2.5;
const SPAWN_AHEAD_Z = -50;
const SPAWN_RANGE_X = 12;
const SPAWN_RANGE_Y = 8;
const SPAWN_MIN_Y = 2;

@component({
  description: 'Server-side enemy spawner. Attach to a scene entity.',
})
export class EnemySpawner extends Component {
  @property()
  enemyTemplate: Maybe<TemplateAsset> = null;

  private lastSpawnTime: number = 0;
  private playerEntity: Maybe<Entity> = null;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.lastSpawnTime = WorldService.get().getWorldTime();
    this.refreshPlayer();
    console.log('[EnemySpawner] Initialized on server');
  }

  @subscribe(OnPlayerCreateEvent, {execution: ExecuteOn.Everywhere})
  onPlayerCreate(payload: OnPlayerCreateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.refreshPlayer();
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (!this.enemyTemplate) return;

    if (!this.playerEntity || this.playerEntity.isDestroyed()) {
      this.refreshPlayer();
      if (!this.playerEntity) return;
    }

    const now = WorldService.get().getWorldTime();
    if (now - this.lastSpawnTime >= SPAWN_INTERVAL) {
      this.lastSpawnTime = now;
      this.spawnEnemy();
    }
  }

  private refreshPlayer(): void {
    const players = PlayerService.get().getAllPlayers();
    this.playerEntity = players.length > 0 ? players[0] : null;
  }

  private async spawnEnemy(): Promise<void> {
    if (!this.enemyTemplate || !this.playerEntity) return;

    const playerPos = this.playerEntity.getComponent(TransformComponent)?.worldPosition;
    if (!playerPos) return;

    const randomX = (Math.random() - 0.5) * 2 * SPAWN_RANGE_X;
    const randomY = SPAWN_MIN_Y + Math.random() * SPAWN_RANGE_Y;
    const spawnZ = playerPos.z + SPAWN_AHEAD_Z;
    const spawnPos = new Vec3(randomX, randomY, spawnZ);
    const dirToPlayer = playerPos.sub(spawnPos).normalize();
    const rotation = Quaternion.lookRotation(dirToPlayer, Vec3.up);

    try {
      await WorldService.get().spawnTemplate({
        templateAsset: this.enemyTemplate,
        networkMode: NetworkMode.Networked,
        position: spawnPos,
        rotation: rotation,
      });
      console.log(`[EnemySpawner] Spawned enemy at (${randomX.toFixed(1)}, ${randomY.toFixed(1)}, ${spawnZ.toFixed(1)})`);
    } catch (err) {
      console.error('[EnemySpawner] Failed to spawn enemy:', err);
    }
  }
}
