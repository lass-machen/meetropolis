import React from 'react';
import type { Room } from 'livekit-client';
import type { WorldRoom } from '../../../types/colyseus';
import { Overlays } from '../../layout/Overlays';
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
type AvState = { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
type ConnStatus = { reconnecting: boolean; lastCode?: number; lastReason?: string };
type Hud = { zone?: string; follow?: string | null; avRoom?: string | null };
type EventHandlers = ReturnType<typeof useWorldEventHandlers>;

export type WorldMainViewProps = {
  apiBase: string;
  me: { id: string; email: string; name?: string };
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
  } = props;
  const topRightMenu = buildTopRightMenu(props);
  const mySessionId = localPosRef.current?.id;

  return (
    <>
      <HeaderOverlays {...props} mySessionId={mySessionId} topRightMenu={topRightMenu} />
      <ConnectionBanners
        connStatus={connStatus}
        showReloadBanner={showReloadBanner}
        onReload={eventHandlers.handleConnectionReloadClick}
        onDismissBanner={eventHandlers.handleDismissBanner}
      />
      {isInternalOwner && paymentStatus && paymentStatus.status !== 'ok' && (
        <PaymentStatusBanner
          paymentStatus={paymentStatus}
          onManageBilling={() => {
            void handleManageBilling();
          }}
        />
      )}
      {/* type-debt: GameCanvas declares RefObject<HTMLDivElement> (non-null) but
          the actual ref in WorldRefs is RefObject<HTMLDivElement | null>. Fixing
          this requires touching GameCanvas.tsx which is outside this wave's scope. */}
      <GameCanvas
        containerRef={containerRef as React.RefObject<HTMLDivElement>}
        positionReady={positionReady}
        avDnd={avState.dnd}
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
