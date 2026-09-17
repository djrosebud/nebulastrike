/**
 * SpaceShooterDamageReceiver — RPC bridge for dealing damage to the player,
 * with an energy shield that absorbs damage before hull HP.
 *
 * Component Attachment: PlayerCharacter root entity
 * Component Networking: Networked
 * Component Ownership: Player (client-owned)
 *
 * Since the player is client-owned, the server cannot directly modify the
 * player's health. This component provides an @rpc() method that the server
 * calls. The RPC routes to the owning client, which first drains the shield
 * and then calls CharacterGASComponent.takeDamage() for any remainder.
 *
 * The shield regenerates after a few seconds without damage. Shield state is
 * broadcast via OnSpaceShooterShieldChangedEvent for HUD/effects wiring.
 */
import {
  component,
  Component,
  subscribe,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  ExecuteOn,
  WorldService,
  rpc,
} from 'meta/worlds';
import type {Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';
import {CharacterGASComponent} from '../gas/CharacterGASComponent';
import {
  OnSpaceShooterShieldChangedEvent,
  SpaceShooterShieldPayload,
} from './SpaceShooterEvents';

const SHIELD_MAX = 50;
const SHIELD_REGEN_PER_SEC = 12;
const SHIELD_REGEN_DELAY_SEC = 3;

@component({
  description: 'RPC bridge for server-to-client damage, with regenerating energy shield. Attach to PlayerCharacter root.',
})
export class SpaceShooterDamageReceiver extends Component {
  private gasComp: Maybe<CharacterGASComponent> = null;
  private shield: number = SHIELD_MAX;
  private lastDamageTime: number = -1000;
  private lastBroadcastShield: number = -1;
  private lastHitAt: number = -1000;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    this.gasComp = this.entity.getComponent(CharacterGASComponent);
    console.log('[SpaceShooterDamageReceiver] Initialized, GAS found:', this.gasComp != null);
  }

  @rpc()
  receiveDamage(amount: number): void {
    console.log(`[SpaceShooterDamageReceiver] Receiving ${amount} damage`);
    if (!this.gasComp) {
      this.gasComp = this.entity.getComponent(CharacterGASComponent);
    }

    const now = WorldService.get().getWorldTime();
    this.lastDamageTime = now;
    this.lastHitAt = now;

    let remaining = amount;
    if (this.shield > 0 && remaining > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
      console.log(`[SpaceShooterDamageReceiver] Shield absorbed ${absorbed} (left: ${this.shield})`);
      if (this.shield <= 0) {
        console.log('[SpaceShooterDamageReceiver] SHIELD DOWN!');
      }
      this.broadcastShield();
    }

    if (remaining > 0 && this.gasComp) {
      console.log(`[SpaceShooterDamageReceiver] Hull damage: ${remaining}`);
      this.gasComp.takeDamage(remaining);
    }
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Owner})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (this.shield >= SHIELD_MAX) return;
    const now = WorldService.get().getWorldTime();
    if (now - this.lastDamageTime < SHIELD_REGEN_DELAY_SEC) return;
    this.shield = Math.min(SHIELD_MAX, this.shield + SHIELD_REGEN_PER_SEC * payload.deltaTime);
    this.broadcastShield();
  }

  public getShield(): number {
    return this.shield;
  }

  public getShieldMax(): number {
    return SHIELD_MAX;
  }

  /** World time of the last damage taken (drives the HUD hit-flash). */
  public getLastHitTime(): number {
    return this.lastHitAt;
  }

  /** Refill the shield (e.g. SHIELD powerup in a later round). */
  public restoreShield(amount: number): void {
    this.shield = Math.min(SHIELD_MAX, this.shield + amount);
    this.broadcastShield();
    console.log(`[SpaceShooterDamageReceiver] Shield restored to ${this.shield}`);
  }

  private broadcastShield(): void {
    const floored = Math.floor(this.shield);
    if (floored === this.lastBroadcastShield) return;
    this.lastBroadcastShield = floored;
    this.entity.sendEventToEveryone(
      OnSpaceShooterShieldChangedEvent,
      new SpaceShooterShieldPayload(this.shield, SHIELD_MAX),
    );
  }
}
