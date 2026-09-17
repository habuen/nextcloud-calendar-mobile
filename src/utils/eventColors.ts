import { CSS3_COLORS, cssColorNameToHex } from './cssColors';

export { cssColorNameToHex };

export interface EventColorOption {
  /** The literal CSS3 keyword written to the iCalendar `COLOR:` property. */
  name: string;
  hex: string;
}

/**
 * A curated subset of the CSS3 keyword space to offer as swatches. Any of
 * these round-trips losslessly through any RFC 7986-aware CalDAV client,
 * including the Nextcloud web calendar and other users sharing the calendar.
 */
export const EVENT_COLOR_PALETTE: readonly EventColorOption[] = [
  'red', 'crimson', 'deeppink', 'orangered', 'orange', 'gold',
  'yellowgreen', 'green', 'seagreen', 'teal', 'dodgerblue', 'royalblue',
  'blueviolet', 'purple', 'magenta', 'brown', 'gray', 'black',
].map((name) => ({ name, hex: CSS3_COLORS[name] }));
