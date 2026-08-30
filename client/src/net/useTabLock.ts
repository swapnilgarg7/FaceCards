import { useEffect, useState } from "react";
import { claimTable, openTabChannel } from "./tabLock.js";

/**
 * Whether this table is already open in another tab of this browser.
 *
 * The protocol, and the reasoning behind it, are in `tabLock.ts`. This is only
 * the React binding: one channel per room code, claimed on mount and released
 * on unmount, which means leaving a table or joining a different one both do
 * the right thing without anything else having to remember to.
 *
 * The channel name carries the code, so two tabs at *different* tables never
 * exchange a message at all - the filtering inside `claimTable` is a second
 * line of defence rather than the mechanism.
 */
export function useTabLock(code: string | null): boolean {
  const [duplicate, setDuplicate] = useState(false);

  useEffect(() => {
    if (!code) return;
    // Reset on a change of table rather than carrying a verdict about the
    // previous one across, which would show a warning about a room this tab
    // has already left.
    setDuplicate(false);

    const lock = claimTable({
      code,
      channel: openTabChannel(`facecards.table.${code}`),
      onConflict: () => setDuplicate(true),
      // Somebody saw the warning and closed the other tab. Taking the message
      // down without a reload is most of what makes it a useful warning rather
      // than an accusation.
      onResolved: () => setDuplicate(false),
    });

    return () => lock.release();
  }, [code]);

  return duplicate;
}
