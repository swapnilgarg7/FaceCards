import { useEffect, useState } from "react";
import { useMedia } from "./media/useMedia.js";
import { useRoom } from "./net/useRoom.js";
import { Lobby } from "./ui/Lobby.js";
import { Table } from "./ui/Table.js";

/**
 * Phase-0 shell: lobby until connected, then the table.
 *
 * The room code lives in the URL so a refresh rejoins the same table, which is
 * the phase-0 exit criterion, and so the invite link is the whole join flow.
 */
export default function App() {
  const room = useRoom();
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

  if (room.status.kind === "connected" && room.snapshot) {
    return (
      <Table
        snapshot={room.snapshot}
        sessionId={room.sessionId}
        media={media}
        onBump={room.bump}
        onLeave={leave}
      />
    );
  }

  return (
    <Lobby
      busy={room.status.kind === "connecting"}
      error={room.status.kind === "error" ? room.status.message : null}
      initialCode={urlCode}
      onCreate={(name) => void room.create(name)}
      onJoin={(code, name) => void room.join(code, name)}
    />
  );
}
