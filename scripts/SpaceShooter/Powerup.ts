/**
 * Powerup — Spinning octahedron pickup dropped by destroyed enemies.
 *
 * Component Attachment: Powerup template root entity (one template per kind,
 * with the matching Blender octahedron mesh as its visual)
 * Component Networking: Networked (spawned by the server)
 * Component Ownership: Server
 *
 * Kinds: 'triple' (3-way shots, 12s), 'rapid' (fast fire, 12s),
 * 'shield' (restore 50 shield). Set `kind` on the template in the editor.
 *
 * Spins and bobs until collected (player within radius) or its lifetime
 * expires. Collection notifies the player's ShootControlsBridge via
 * OnSpaceShooterPowerupCollectedEvent.
 */

import {
  component,
  Component,
  property,
  subscribe,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  ExecuteOn,
  TransformComponent,
  Vec3,
  Quaternion,
  WorldService,
  NetworkingService,
  PlayerService,
} from 'meta/worlds';
import type {Maybe, Entity, OnWorldUpdateEventPayload} from 'meta/worlds';
import {
  OnSpaceShooterPowerupCollectedEvent,
  SpaceShooterPowerupPayload,
} from './SpaceShooterEvents';

const LIFETIME_SEC = 18;
const COLLECT_RADIUS = 2.5;
const POP_TIME = 0.22;
const SPIN_DEG_PER_SEC = 120;
const BOB_AMPLITUDE = 0.4;
const BOB_FREQUENCY = 2.5;

@component({
  description: "Spinning powerup pickup ('triple' | 'rapid' | 'shield'). Attach to powerup template root.",
})
export class Powerup extends Component {
  /** 'triple' | 'rapid' | 'shield'. Set per-template in the editor. */
  @property()
  kind: string = 'triple';

  private transform: Maybe<TransformComponent> = null;
  private playerEntity: Maybe<Entity> = null;
  private baseY: number = 0;
  private age: number = 0;
  private collected: boolean = false;
  private popT: number = 0;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.transform = this.entity.getComponent(TransformComponent);
    if (this.transform) {
      this.baseY = this.transform.worldPosition.y;
    }
    const players = PlayerService.get().getAllPlayers();
    this.playerEntity = players.length > 0 ? players[0] : null;
    console.log(`[Powerup] Spawned kind=${this.kind}`);
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (!this.transform) return;

    const dt = payload.deltaTime;

    // Collect pop animation, then destroy
    if (this.collected) {
      this.popT += dt;
      const s = 1 + (this.popT / POP_TIME) * 0.9;
      this.transform.worldScale = new Vec3(s, s, s);
      if (this.popT >= POP_TIME) {
        this.entity.destroy();
      }
      return;
    }

    this.age += dt;
    if (this.age >= LIFETIME_SEC) {
      this.entity.destroy();
      return;
    }

    // Spin + bob
    this.transform.worldRotation = Quaternion.fromEuler(
      0,
      this.age * SPIN_DEG_PER_SEC,
      0,
    );
    const pos = this.transform.worldPosition;
    this.transform.worldPosition = new Vec3(
      pos.x,
      this.baseY + Math.sin(this.age * BOB_FREQUENCY) * BOB_AMPLITUDE,
      pos.z,
    );

    // Re-find player if lost
    if (!this.playerEntity || this.playerEntity.isDestroyed()) {
      const players = PlayerService.get().getAllPlayers();
      this.playerEntity = players.length > 0 ? players[0] : null;
    }
    if (!this.playerEntity) return;

    const playerTransform = this.playerEntity.getComponent(TransformComponent);
    if (!playerTransform) return;
    const dist = playerTransform.worldPosition.sub(pos).magnitude();
    if (dist < COLLECT_RADIUS) {
      this.collected = true;
      this.popT = 0;
      console.log(`[Powerup] Collected kind=${this.kind}`);
      this.playerEntity.sendEventToEveryone(
        OnSpaceShooterPowerupCollectedEvent,
        new SpaceShooterPowerupPayload(this.kind),
      );
    }
  }
}
