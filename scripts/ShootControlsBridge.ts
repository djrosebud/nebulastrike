/**
 * ShootControlsBridge — Bridges the on-screen 'Shoot' hold-button and the
 * twin-stick aim to ShootAction.fireShot() with a client-side fire interval.
 *
 * Component Attachment: Player entity (alongside ShootAction)
 * Component Networking: Local (runs on Owner only)
 * Component Ownership: Player (client-owned)
 *
 * The Shoot button is hold (momentary=false): pressed=true while held,
 * false on release. Deflecting the aim stick (see SpaceShipController) also
 * fires, twin-stick style. This bridge polls each frame and calls fireShot()
 * with the current aim direction on a cooldown.
 *
 * Powerup weapon modes (from OnSpaceShooterPowerupCollectedEvent):
 * - TRIPLE: 3-way spread for 12s
 * - RAPID: fast fire for 12s
 * - SHIELD: instantly restores 50 shield (handled here via DamageReceiver)
 * Timer expiry returns to single shot.
 */

import {
  Component,
  component,
  subscribe,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  OnEntityDestroyEvent,
  ExecuteOn,
  WorldService,
} from 'meta/worlds';
import type {Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';
import {InputActionsManager} from './Input/InputActionsManager';
import {ShootAction} from './ShootAction';
import {SpaceShipController} from './SpaceShooter/SpaceShipController';
import {SpaceShooterDamageReceiver} from './SpaceShooter/SpaceShooterDamageReceiver';
import {
  OnSpaceShooterPowerupCollectedEvent,
  OnSpaceShooterWaveChangedEvent,
  SpaceShooterPowerupPayload,
  SpaceShooterWavePayload,
} from './SpaceShooter/SpaceShooterEvents';

const FIRE_INTERVAL = 0.2; // seconds between shots while held
const RAPID_FIRE_INTERVAL = 0.09;
const WEAPON_DURATION = 12; // powerup weapon mode seconds

export type WeaponMode = 'single' | 'triple' | 'rapid';

@component({
  description:
    'Fires ShootAction toward the twin-stick aim on a cooldown while the Shoot button is held or the aim stick is deflected. Handles TRIPLE/RAPID/SHIELD powerup modes. Attach to player entity alongside ShootAction.',
})
export class ShootControlsBridge extends Component {
  private shootAction: Maybe<ShootAction> = null;
  private ship: Maybe<SpaceShipController> = null;
  private lastFireTime: number = 0;
  private wired: boolean = false;
  private weaponMode: WeaponMode = 'single';
  private weaponTimeLeft: number = 0;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Owner})
  onStart(): void {
    this.shootAction = this.entity.getComponent(ShootAction);
    this.ship = this.entity.getComponent(SpaceShipController);
    this.wire();
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Owner})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!this.wired) {
      this.wire();
    }

    // Powerup timer expiry returns to single shot
    if (this.weaponMode !== 'single') {
      this.weaponTimeLeft -= payload.deltaTime;
      if (this.weaponTimeLeft <= 0) {
        this.weaponMode = 'single';
        this.weaponTimeLeft = 0;
        console.log('[ShootControlsBridge] Powerup expired — back to single shot');
      }
    }

    const manager = InputActionsManager.instance;
    if (!manager || !this.shootAction) {
      return;
    }

    const firing = manager.isPressed('Shoot') || (this.ship?.isAimFiring() ?? false);
    if (firing) {
      const now = WorldService.get().getWorldTime();
      const interval = this.weaponMode === 'rapid' ? RAPID_FIRE_INTERVAL : FIRE_INTERVAL;
      if (now - this.lastFireTime >= interval) {
        this.shootAction.fireShot(
          this.ship?.getAimDirection(),
          this.weaponMode === 'triple' ? 3 : 1,
          this.weaponMode === 'rapid',
        );
        this.lastFireTime = now;
      }
    }
  }

  @subscribe(OnSpaceShooterPowerupCollectedEvent, {execution: ExecuteOn.Owner})
  onPowerup(payload: SpaceShooterPowerupPayload): void {
    const kind = payload.kind;
    if (kind === 'shield') {
      const receiver = this.entity.getComponent(SpaceShooterDamageReceiver);
      if (receiver) {
        receiver.restoreShield(50);
        console.log('[ShootControlsBridge] SHIELD powerup: +50 shield');
      }
      return;
    }
    if (kind === 'triple' || kind === 'rapid') {
      this.weaponMode = kind;
      this.weaponTimeLeft = WEAPON_DURATION;
      console.log(`[ShootControlsBridge] ${kind.toUpperCase()} powerup active for ${WEAPON_DURATION}s`);
    }
  }

  @subscribe(OnEntityDestroyEvent, {execution: ExecuteOn.Owner})
  onDestroy(): void {
    this.wired = false;
  }

  /** New run (wave 1 also fires on restart): drop any powerup weapon mode. */
  @subscribe(OnSpaceShooterWaveChangedEvent, {execution: ExecuteOn.Owner})
  onWaveChanged(payload: SpaceShooterWavePayload): void {
    if (payload.wave === 1) {
      this.weaponMode = 'single';
      this.weaponTimeLeft = 0;
    }
  }

  public getWeaponMode(): WeaponMode {
    return this.weaponMode;
  }

  public getWeaponTimeLeft(): number {
    return Math.max(0, this.weaponTimeLeft);
  }

  private wire(): void {
    if (this.wired) {
      return;
    }
    if (InputActionsManager.instance == null) {
      return;
    }
    this.shootAction = this.entity.getComponent(ShootAction);
    this.ship = this.entity.getComponent(SpaceShipController);
    if (this.shootAction) {
      this.wired = true;
      console.log('[ShootControlsBridge] Wired to ShootAction');
    }
  }
}
