import { redirect } from "next/navigation";
import { FloatingChat } from "@/components/chat/FloatingChat";
import { MiniPlayer } from "@/components/studio/MiniPlayer";
import { PlayerProvider } from "@/components/studio/PlayerProvider";
import { ScriptProvider } from "@/components/ScriptProvider";
import { getSessionUser } from "@/lib/auth/session";
import { StudioShell } from "@/components/studio/StudioShell";
import { openDirectConversation } from "@/lib/chat";
import { iceServersForCall } from "@/lib/turn";

/**
 * Guards every workbench route. The check runs server-side on each request, so
 * an expired or revoked session cannot render the shell at all.
 *
 * The floating chat is mounted here rather than on the chat page, because an
 * incoming call has to ring wherever you are — when the call panel lived
 * inside the conversation, the phone only rang if you were already looking at
 * it.
 */
export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [conversationId, iceServers] = await Promise.all([
    openDirectConversation(user.id),
    iceServersForCall(),
  ]);

  return (
    /*
     * 播放器在這一層 (Z124)。
     *
     * The audio element has to live above the pages or navigating unmounts
     * it — opening the episode you are scoring used to stop the music you
     * were scoring it to.
     */
    /*
     * 繁簡切換在最外層 (Z135)。
     *
     * 它改的是整個畫面上顯示的字，所以必須包住所有東西——包含浮動的對話球
     * 與迷你播放器。資料一個字都不會變，這只是顯示。
     */
    <ScriptProvider>
      <PlayerProvider>
        <StudioShell user={user}>
          {children}
          <FloatingChat
            conversationId={conversationId}
            meId={user.id}
            iceServers={iceServers}
          />
          <MiniPlayer />
        </StudioShell>
      </PlayerProvider>
    </ScriptProvider>
  );
}
