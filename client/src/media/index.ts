/**
 * The public face of the media boundary.
 *
 * Import from `../media` and nowhere deeper. `LiveKitProvider` is exported as
 * a factory rather than a class so callers never name the vendor either.
 */
import { LiveKitProvider } from "./LiveKitProvider.js";
import type { MediaProvider } from "./MediaProvider.js";

export type {
  MediaConnectionState,
  MediaCredentials,
  MediaProvider,
  PublishOptions,
  TrackKind,
  Unsubscribe,
} from "./MediaProvider.js";

/** Build the configured media provider. Swapping SFUs is a change here. */
export function createMediaProvider(): MediaProvider {
  return new LiveKitProvider();
}
