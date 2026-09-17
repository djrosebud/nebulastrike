/**
 * SpaceShooterDamageReceiver — RPC bridge for dealing damage to the player.
 *
 * Component Attachment: PlayerCharacter root entity
 * Component Networking: Networked
 * Component Ownership: Player (client-owned)
 *
 * Since the player is client-owned, the server cannot directly modify the
 * player's health. This component provides an @rpc() method that the server
 * calls. The RPC routes to the owning client, which then calls
 * CharacterGASComponent.takeDamage().
 */
import {
  component,
  Component,
  subscribe,
  OnEntityStartEvent,
  ExecuteOn,
  rpc,
} from 'meta/worlds';
import type {Maybe} from 'meta/worlds';
import {CharacterGASComponent} from '../gas/CharacterGASComponent';

@component({
  description: 'RPC bridge for server-to-client damage. Attach to PlayerCharacter root.',
})
export class SpaceShooterDamageReceiver extends Component {
  private gasComp: Maybe<CharacterGASComponent> = null;

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
    if (this.gasComp) {
      this.gasComp.takeDamage(amount);
    }
  }
}
