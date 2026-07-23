import React from 'react';
import type { Room } from 'livekit-client';
import type { WorldRoom } from '../../../types/colyseus';
import { Overlays, isFullscreenOverlayOpen } from '../../layout/Overlays';
import { GameCanvas } from './GameCanvas';
import { ConnectionBanners } from './ConnectionBanners';
import { AdminOverlay } from '../../../ui/admin/AdminOverlay';
import { MapSwitcher } from '../../../ui/hud/MapSwitcher';
import { getEnterpriseWebModule } from '../../../lib/enterpriseWebLoader';

type PackStoreProps = { apiBase: string; open: boolean; onOpenChange: (v: boolean) => void };

const PackStoreFallback: React.ComponentType<PackStoreProps> = () => null;

const PackStoreLazy = React.lazy<React.ComponentType<PackStoreProps>>(async () => {
  const mod = await getEnterpriseWebModule();
  if (!mod) return { default: PackStoreFallback };
  return { default: mod.PackStore as React.ComponentType<PackStoreProps> };
});
import { ZoneAccessPanel } from '../../../ui/hud/ZoneAccessPanel';
import { AVControlBar } from './AVControlBar';
import { PaymentStatusBanner } from '../../../ui/billing/components/PaymentStatusBanner';
import { EmailVerificationBanner } from '../../../ui/billing/components/EmailVerificationBanner';
import type { AdminCapabilities } from '../hooks/useFetchMe';
import type { EditorState } from '../../../services/EditorService';
import type { PaymentStatus } from '../../../ui/billing/types';
import type { useWorldEventHandlers } from '../hooks/useWorldEventHandlers';

type Participant = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
};
type AvState = { mic: boolean; cam: boolean; share: boolean; dnd: boolean; micPending?: boolean };
type ConnStatus = { reconnecting: boolean; lastCode?: number; lastReason?: string };
type Hud = { zone?: string; follow?: string | null; avRoom?: string | null };
type EventHandlers = ReturnType<typeof useWorldEventHandlers>;

export type WorldMainViewProps = {
  apiBase: string;
  me: { id: string; email: string; name?: string; emailVerified?: boolean };
  containerRef: React.RefObject<HTMLDivElement | null>;
  colyseusRef: React.RefObject<WorldRoom | null>;
  localPosRef: React.RefObject<{ id: string; x?: number; y?: number }>;
  hud: Hud;
  editor: EditorState;
  avState: AvState;
  participantsToRender: Participant[];
  gridExpanded: boolean;
  selectedSid: string | null;
  overlayZoom: number;
  setOverlayZoom: React.Dispatch<React.SetStateAction<number>>;
  menuOpen: boolean;
  isInternalOwner: boolean;
  isTenantAdmin: boolean;
  billingAvailable: boolean;
  capabilities: AdminCapabilities;
  paymentStatus: PaymentStatus | null;
  handleManageBilling: () => void | Promise<void>;
  positionReady: boolean;
  showReloadBanner: boolean;
  connStatus: ConnStatus;
  adminOpen: boolean;
  setAdminOpen: React.Dispatch<React.SetStateAction<boolean>>;
  packStoreOpen: boolean;
  setPackStoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  devices: { mics: { id: string; label: string }[]; cams: { id: string; label: string }[] };
  selectedMicId: string;
  selectedCamId: string;
  cameraManual: boolean;
  pttAwareToggleMic: () => Promise<void>;
  eventHandlers: EventHandlers;
  getRoom: () => Room | undefined;
};

function buildTopRightMenu(props: WorldMainViewProps) {
  const { menuOpen, isInternalOwner, isTenantAdmin, billingAvailable, eventHandlers, setPackStoreOpen, editor } = props;
  return {
    menuOpen,
    onToggleMenu: eventHandlers.handleToggleMenu,
    ...(isTenantAdmin ? { onOpenUsers: eventHandlers.handleOpenUsers } : {}),
    ...(isTenantAdmin ? { onOpenInvites: eventHandlers.handleOpenInvites } : {}),
    onOpenAdmin: eventHandlers.handleOpenAdmin,
    isAdmin: isInternalOwner,
    ...(isTenantAdmin && billingAvailable ? { onOpenBilling: eventHandlers.handleOpenBilling } : {}),
    onOpenProfile: eventHandlers.handleOpenProfile,
    ...(isTenantAdmin ? { onOpenTenantSettings: eventHandlers.handleOpenTenantSettings } : {}),
    ...(isTenantAdmin ? { onOpenSessions: eventHandlers.handleOpenSessions } : {}),
    ...(isTenantAdmin ? { onOpenPackStore: () => setPackStoreOpen(true) } : {}),
    onResetApp: eventHandlers.handleResetApp,
    ...(isTenantAdmin ? { onToggleEditor: eventHandlers.handleToggleEditor } : {}),
    editorActive: editor.active,
    onLogout: eventHandlers.handleLogout,
  };
}

function HeaderOverlays(
  props: WorldMainViewProps & {
    mySessionId: string | undefined;
    topRightMenu: ReturnType<typeof buildTopRightMenu>;
  },
) {
  const {
    hud,
    editor,
    avState,
    participantsToRender,
    gridExpanded,
    selectedSid,
    overlayZoom,
    setOverlayZoom,
    eventHandlers,
    colyseusRef,
    getRoom,
    mySessionId,
    topRightMenu,
  } = props;
  return (
    <Overlays
      hud={hud}
      editorActive={editor.active}
      avDnd={avState.dnd}
      participants={participantsToRender}
      gridExpanded={gridExpanded}
      onToggleExpand={eventHandlers.handleToggleExpand}
      selectedSid={selectedSid}
      onSelectSid={eventHandlers.handleSelectSid}
      getRoom={getRoom}
      overlayZoom={overlayZoom}
      onZoom={(z) => setOverlayZoom(z)}
      colyseusRef={colyseusRef}
      {...(mySessionId !== undefined ? { mySessionId } : {})}
      topRightMenu={topRightMenu}
    />
  );
}

/**
 * Splits the world view into two independent stacking layers: banners in
 * normal document flow on top, and the header bar + game canvas below them
 * in their own positioned box.
 *
 * Fixes A15: the top header bar (`.top-header-bar`, absolute, top:0) and a
 * banner both used to anchor to the same containing block, so whichever one
 * won the stacking order could visually or interactively cover the other's
 * controls (the menu button behind an unrelated banner, or vice versa). By
 * giving the header/canvas pair their own `position: relative` box *after*
 * the banner slot in flow, the header bar's `top: 0` always means "top of
 * the game surface", never "top of the whole view" — so a banner pushes the
 * game surface down instead of overlapping it, and no z-index tug-of-war is
 * needed between banner and header content.
 *
 * On the `overflow: hidden` below: it clips the game surface, and it does NOT
 * introduce a clipping edge that was not there before. The parent
 * (`MainContent` in WorldShell) is already `position: relative; overflow:
 * hidden` across the whole view, and this box shares its bottom, left and right
 * edge. What genuinely changes is that the header bar — and with it the menu
 * dropdown anchored under it — now starts one banner height further down, so a
 * fully expanded admin menu has that much less room before it reaches the
 * (unchanged) bottom edge. The dropdown is absolutely positioned inside the menu
 * button and therefore depends on ancestor overflow; bounding its own height is
 * the durable fix for that and lives in `TopRightMenu` (`useDropdownMaxHeight`).
 *
 * The second consequence is handled by the caller: everything the game surface
 * contains — including the fullscreen participant overlay, which is
 * `position: absolute; inset: 0` — is now positioned against THIS box rather
 * than against the whole view, so a banner would stay visible above a fullscreen
 * video. {@link WorldMainView} therefore collapses the banner row for exactly as
 * long as that overlay is open, which restores the pre-A15 result (the banner
 * was covered by the opaque overlay) without giving the overlay a viewport-wide
 * `position: fixed` it never had.
 */
export function BannerAndGameLayout({
  banners,
  headerAndCanvas,
  bannersHidden = false,
}: {
  banners: React.ReactNode;
  headerAndCanvas: React.ReactNode;
  /**
   * Collapse the banner row so the game surface spans the whole view. Used
   * while the fullscreen participant overlay is open. `display: none` rather
   * than dropping the children: the banners keep their local state and reappear
   * unchanged when the overlay closes.
   */
  bannersHidden?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={bannersHidden ? { display: 'none' } : undefined}>{banners}</div>
      <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>{headerAndCanvas}</div>
    </div>
  );
}

function ControlBar(props: WorldMainViewProps) {
  const { editor, avState, devices, selectedMicId, selectedCamId, cameraManual, pttAwareToggleMic, eventHandlers } =
    props;
  return (
    <AVControlBar
      editorActive={editor.active}
      avState={avState}
      devices={devices}
      selectedMicId={selectedMicId}
      selectedCamId={selectedCamId}
      cameraManual={cameraManual}
      onToggleMic={pttAwareToggleMic}
      onSelectMic={eventHandlers.handleSelectMic}
      onToggleCam={eventHandlers.handleToggleCam}
      onSelectCam={eventHandlers.handleSelectCam}
      onToggleShare={eventHandlers.handleToggleShare}
      onToggleDnd={() => {
        eventHandlers.handleToggleDnd();
        return Promise.resolve();
      }}
      onRecenter={eventHandlers.handleRecenter}
    />
  );
}

export function WorldMainView(props: WorldMainViewProps) {
  const {
    apiBase,
    me,
    containerRef,
    colyseusRef,
    localPosRef,
    hud,
    editor,
    avState,
    isInternalOwner,
    capabilities,
    paymentStatus,
    handleManageBilling,
    positionReady,
    showReloadBanner,
    connStatus,
    adminOpen,
    setAdminOpen,
    packStoreOpen,
    setPackStoreOpen,
    eventHandlers,
    selectedSid,
  } = props;
  const topRightMenu = buildTopRightMenu(props);
  const mySessionId = localPosRef.current?.id;
  // While the fullscreen participant view is up it must cover everything, as it
  // did before the banner row existed: the overlay is `position: absolute;
  // inset: 0` inside the game surface, so a visible banner would sit above the
  // video instead of behind it.
  const fullscreenOverlayOpen = isFullscreenOverlayOpen({
    editorActive: editor.active,
    avDnd: avState.dnd,
    selectedSid,
  });

  return (
    <>
      <BannerAndGameLayout
        bannersHidden={fullscreenOverlayOpen}
        banners={
          <>
            <EmailVerificationBanner emailVerified={me.emailVerified} apiBase={apiBase} />
            {isInternalOwner && paymentStatus && paymentStatus.status !== 'ok' && (
              <PaymentStatusBanner
                paymentStatus={paymentStatus}
                onManageBilling={() => {
                  void handleManageBilling();
                }}
              />
            )}
          </>
        }
        headerAndCanvas={
          <>
            <HeaderOverlays {...props} mySessionId={mySessionId} topRightMenu={topRightMenu} />
            {/* type-debt: GameCanvas declares RefObject<HTMLDivElement> (non-null) but
                the actual ref in WorldRefs is RefObject<HTMLDivElement | null>. Fixing
                this requires touching GameCanvas.tsx which is outside this wave's scope. */}
            <GameCanvas
              containerRef={containerRef as React.RefObject<HTMLDivElement>}
              positionReady={positionReady}
              avDnd={avState.dnd}
            />
          </>
        }
      />
      <ConnectionBanners
        connStatus={connStatus}
        showReloadBanner={showReloadBanner}
        onReload={eventHandlers.handleConnectionReloadClick}
        onDismissBanner={eventHandlers.handleDismissBanner}
      />
      {isInternalOwner && (
        <AdminOverlay apiBase={apiBase} open={adminOpen} onOpenChange={setAdminOpen} capabilities={capabilities} />
      )}
      <React.Suspense fallback={null}>
        <PackStoreLazy apiBase={apiBase} open={packStoreOpen} onOpenChange={setPackStoreOpen} />
      </React.Suspense>
      {!editor.active && (
        <div style={{ position: 'absolute', bottom: 70, left: 12, zIndex: 30 }}>
          <MapSwitcher room={connStatus.reconnecting ? null : colyseusRef.current} />
        </div>
      )}
      <ZoneAccessPanel
        colyseusRef={colyseusRef}
        mySessionId={mySessionId || ''}
        {...(hud.zone && hud.zone !== '-' ? { currentZone: hud.zone } : {})}
      />
      <ControlBar {...props} />
    </>
  );
}
