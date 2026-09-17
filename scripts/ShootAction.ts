console.log('[ShootAction] Module loading...');

/**
 * ShootAction - Fires a projectile from a public `fireShot()` method.
 *
 * Attach this component to the player entity. Calling `fireShot()` sends a
 * RequestShootEvent to the server, which then spawns the projectile.
 *
 * This component is INPUT-AGNOSTIC and portable: it imports only `meta/worlds`
 * and the bundled ProjectileEvents, and it never binds an engine input slot.
 * Something else (project glue) decides when to call `fireShot()`.
 *
 * Component Attachment: Player entity
 * Component Networking: Networked (sends events to server)
 * Component Ownership: Client-owned (attached to player)
 *
 * SETUP:
 * 1. Copy to scripts/ShootAction.ts
 * 2. Add ShootAction to the player entity.
 * 3. Wire input to fireShot() via project glue (see the skill .md, Step 4).
 *
 * NETWORKING PATTERN:
 * - Player is CLIENT-OWNED, so this code runs on the client
 * - Clients CANNOT spawn NetworkMode.Networked entities directly
 * - Instead, we send RequestShootEvent to the server using entity.sendEventToEveryone
 * - This sends to ALL components on the entity's replicants (including ProjectileShooter on server)
 * - The server (via ProjectileShooter) handles the actual spawning
 */

// INPUT: this component does not bind input. Add a 'Shoot' button via the
// building-on-screen-controls skill and, in project glue, subscribe to the
// InputActionsManager 'Shoot' action to call fireShot() (see the skill .md).

import {
  Component,
  component,
  subscribe,
  OnEntityStartEvent,
  ExecuteOn,
  TransformComponent,
  Vec3,
  NetworkingService,
} from "meta/worlds";
import type { Maybe } from "meta/worlds";

import { RequestShootEvent, RequestShootPayload } from './Projectile/ProjectileEvents';

@component()
export class ShootAction extends Component {
  private transform: Maybe<TransformComponent> = null;

  // ⚠️ Muzzle offset values - MUST match ProjectileShooter properties.
  // These determine where the client reports the spawn position; the server
  // uses ProjectileShooter's matching offsets to actually spawn the projectile.
  // A mismatch causes the bullet to appear at a different position than intended.
  private muzzleOffsetX: number = 0;
  private muzzleOffsetY: number = 0;
  private muzzleOffsetZ: number = -5.0;

  @subscribe(OnEntityStartEvent, { execution: ExecuteOn.Owner })
  onStart(): void {
    console.log('[ShootAction] Initializing shoot action');

    // Get transform for calculating spawn position
    this.transform = this.entity.getComponent(TransformComponent);
  }

  // Fire one shot. Call this from project glue on a `Shoot` input press.
  public fireShot(): void {
    // Only the owner can fire their weapon
    if (!this.entity.isOwned()) {
      return;
    }

    // This should only run on the owning client
    if (!NetworkingService.get().isPlayerContext()) {
      return;
    }

    if (!this.transform) {
      console.log('[ShootAction] Cannot shoot - no transform');
      return;
    }

    console.log('[ShootAction] Shoot pressed - sending RequestShootEvent to server');

    // Calculate spawn position and aim direction on the client
    const worldPos = this.transform.worldPosition;
    const worldRot = this.transform.worldRotation;

    // Calculate muzzle position in world space
    const localOffset = new Vec3(
      this.muzzleOffsetX,
      this.muzzleOffsetY,
      this.muzzleOffsetZ,
    );
    const worldOffset = worldRot.mulVec3(localOffset);
    const spawnPosition = new Vec3(
      worldPos.x + worldOffset.x,
      worldPos.y + worldOffset.y,
      worldPos.z + worldOffset.z,
    );

    // Get aim direction (entity's forward direction)
    const aimDirection = this.transform.worldForward;

    // CRITICAL FIX: Use entity.sendEventToEveryone instead of this.sendEventToEveryone
    // - this.sendEventToEveryone sends to SAME COMPONENT TYPE (ShootAction) on other replicants
    // - entity.sendEventToEveryone sends to ALL COMPONENTS on the entity's replicants
    // This ensures ProjectileShooter (different component type) receives the event on the server
    //
    // CRITICAL FIX: Use new RequestShootPayload() instead of object literal
    // - @serializable() classes require proper instantiation for network serialization
    // - Object literals bypass the serialization decorator and cause the event to be dropped
    this.entity.sendEventToEveryone(RequestShootEvent, new RequestShootPayload(
      spawnPosition.x,
      spawnPosition.y,
      spawnPosition.z,
      aimDirection.x,
      aimDirection.y,
      aimDirection.z,
    ));

    console.log('[ShootAction] Event sent to server via entity.sendEventToEveryone');
  }
}
