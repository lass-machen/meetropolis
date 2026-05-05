import React from 'react';
import { Overlays } from '../../layout/Overlays';
import { GameCanvas } from './GameCanvas';
import { ConnectionBanners } from './ConnectionBanners';
import { AdminOverlay } from '../../../ui/admin/AdminOverlay';
import { PackStore } from '../../../ui/packstore/PackStore';
import { MapSwitcher } from '../../../ui/hud/MapSwitcher';
import { ZoneAccessPanel } from '../../../ui/hud/ZoneAccessPanel';
import { AVControlBar } from './AVControlBar';
import { PaymentStatusBanner } from '../../../ui/billing/components/PaymentStatusBanner';
import type { AdminCapabilities } from '../hooks/useFetchMe';

type Participant = { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number };
type AvState = { mic: boolean; cam: boolean; share: boolean; dnd: boolean };
type ConnStatus = { reconnecting: boolean; lastCode?: number; lastReason?: string };
type Hud = { zone?: string; follow?: string | null; avRoom?: string | null };

export type WorldMainViewProps = {
  apiBase: string;
  me: { id: string; email: string; name?: string };
  containerRef: React.RefObject<HTMLDivElement>;
  colyseusRef: React.RefObject<any>;
  localPosRef: React.RefObject<{ id: string; x?: number; y?: number }>;
  hud: Hud;
  editor: any;
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
  paymentStatus: any;
  handleManageBilling: () => void | Promise<void>;
  positionReady: boolean;
  showReloadBanner: boolean;
  connStatus: ConnStatus;
  adminOpen: boolean;
  setAdminOpen: React.Dispatch<React.SetStateAction<boolean>>;
  packStoreOpen: boolean;
  setPackStoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  devices: { mics: { id: string; label: string }[]; cams: { id: string; label: string }[] };
  selectedMicId: string | '';
  selectedCamId: string | '';
  cameraManual: boolean;
  pttAwareToggleMic: () => void | Promise<void>;
  eventHandlers: any;
  getRoom: () => any;
};

export function WorldMainView(props: WorldMainViewProps) {
  const {
    apiBase, containerRef, colyseusRef, localPosRef, hud, editor, avState,
    participantsToRender, gridExpanded, selectedSid, overlayZoom, setOverlayZoom, menuOpen,
    isInternalOwner, isTenantAdmin, billingAvailable, capabilities, paymentStatus,
    handleManageBilling, positionReady, showReloadBanner, connStatus,
    adminOpen, setAdminOpen, packStoreOpen, setPackStoreOpen,
    devices, selectedMicId, selectedCamId, cameraManual, pttAwareToggleMic,
    eventHandlers, getRoom,
  } = props;

  const topRightMenu = {
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

  return (
    <>
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
        mySessionId={localPosRef.current?.id}
        topRightMenu={topRightMenu}
      />
      <ConnectionBanners
        connStatus={connStatus}
        showReloadBanner={showReloadBanner}
        onReload={eventHandlers.handleConnectionReloadClick}
        onDismissBanner={eventHandlers.handleDismissBanner}
      />
      {isInternalOwner && paymentStatus && paymentStatus.status !== 'ok' && (
        <PaymentStatusBanner paymentStatus={paymentStatus} onManageBilling={handleManageBilling} />
      )}
      <GameCanvas containerRef={containerRef} positionReady={positionReady} avDnd={avState.dnd} />
      {isInternalOwner && (
        <AdminOverlay apiBase={apiBase} open={adminOpen} onOpenChange={setAdminOpen} capabilities={capabilities} />
      )}
      <PackStore apiBase={apiBase} open={packStoreOpen} onOpenChange={setPackStoreOpen} />
      {!editor.active && (
        <div style={{ position: 'absolute', bottom: 70, left: 12, zIndex: 30 }}>
          <MapSwitcher room={connStatus.reconnecting ? null : colyseusRef.current} />
        </div>
      )}
      <ZoneAccessPanel
        colyseusRef={colyseusRef}
        mySessionId={localPosRef.current?.id}
        currentZone={hud.zone !== '-' ? hud.zone : undefined}
      />
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
        onToggleDnd={eventHandlers.handleToggleDnd}
        onRecenter={eventHandlers.handleRecenter}
      />
    </>
  );
}
