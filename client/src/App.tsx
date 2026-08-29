import { useEffect, useState } from "react";
import { useMedia } from "./media/useMedia.js";
import { useRoom } from "./net/useRoom.js";
import { Lobby } from "./ui/Lobby.js";
import { Table } from "./ui/Table.js";
import { ViewportProvider, useViewport } from "./ui/useViewport.js";

/**
 * Phase-0 shell: lobby until connected, then the table.
 *
 * The room code lives in the URL so a refresh rejoins the same table, which is
 * the phase-0 exit criterion, and so the invite link is the whole join flow.
 */
export default function App() {
  const room = useRoom();
  // Measured once for the whole app, and stamped onto the document element so
  // the stylesheet answers the same question the components do. See
  // `ui/viewport.ts` for what compact and touch each mean.
  const view = useViewport();
  // Media credentials come from the game server over the authoritative socket,
  // minted against this client's session id. The client never states who it is.
  const media = useMedia(room.mediaToken);

  // Read once at mount. Recomputing per render would let the URL rewrite above
  // race the lobby's prefilled code field.
  const [urlCode] = useState(
    () =>
      new URLSearchParams(window.location.search).get("room")?.toUpperCase() ??
      "",
  );

  // Put the room in the address bar once we are in one, so a refresh returns
  // to the same table and the URL is the invite.
  //
  // This only ever *adds* the parameter. Clearing it here would strip the code
  // out of an invite link the instant it loaded, before the guest had joined,
  // which turns a shared link into a bare lobby. Leaving is the one action
  // that removes it, and it does so explicitly below.
  useEffect(() => {
    const code = room.snapshot?.code;
    if (!code) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("room") === code) return;
    url.searchParams.set("room", code);
    window.history.replaceState(null, "", url);
  }, [room.snapshot?.code]);

  const leave = () => {
    void room.leave();
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  };

  // A reconnecting room still shows the table. The seat, the stack and the
  // cards are all still ours on the server while its window is open, so
  // dropping back to the lobby would be a lie about where we are - and would
  // invite a fresh join that took a new seat and a new thousand chips.
  const seated =
    room.status.kind === "connected" || room.status.kind === "reconnecting";

  if (seated && room.snapshot) {
    return (
      <ViewportProvider value={view}>
      <Table
        snapshot={room.snapshot}
        sessionId={room.sessionId}
        media={media}
        rejection={room.rejection}
        reconnecting={room.status.kind === "reconnecting"}
        onAct={room.act}
        onReady={room.setReady}
        onNextHand={room.nextHand}
        onSitOutChange={room.setSittingOut}
        onBuyIn={room.buyIn}
        onLeave={leave}
      />
      </ViewportProvider>
    );
  }

  return (
    <ViewportProvider value={view}>
      <Lobby
      busy={room.status.kind === "connecting"}
      error={room.status.kind === "error" ? room.status.message : null}
      initialCode={urlCode}
      onCreate={(name, avatar) => void room.create(name, avatar)}
      onJoin={(code, name, avatar) => void room.join(code, name, avatar)}
      />
    </ViewportProvider>
  );
}
