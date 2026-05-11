import type { Room } from 'livekit-client';
import { gameBridge } from '../../../game/bridge';
import { logger } from '../../../lib/logger';
import { EditorService } from '../../../services/EditorService';
import { OnboardingWizard } from '../../../ui/onboarding/OnboardingWizard';
import { MapChangeOverlay } from '../../../ui/hud/MapChangeOverlay';
import { RosterPanel } from '../../../ui/user/RosterPanel';
import { EditorWindow } from '../../../features/editor/EditorWindow';
import { BubbleBanner } from '../../../ui/user/BubbleBanner';
import { WorldContextMenu } from './WorldContextMenu';
import { WorldModals } from './WorldModals';
import { WorldMainView } from './WorldMainView';
import type { WorldRefs, WorldUi, WorldAuth, WorldMe } from '../hooks/useWorldAppState';
import type { EditorState } from '../../../services/EditorService';
import type { DesktopModule } from '../../../lib/desktopLoader';
import type { PaymentStatus } from '../../../ui/billing/types';
import type { useWorldEventHandlers } from '../hooks/useWorldEventHandlers';
import type { Position } from '../../../types/game';

type AnyMe = NonNullable<WorldMe>;

type EventHandlers = ReturnType<typeof useWorldEventHandlers>;

type ParticipantToRender = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
};

export type WorldShellProps = {
  isMini: boolean;
  desktop: DesktopModule | null;
  toggleMiniMode: () => void;
  tauriPrefsOpen: boolean;
  setTauriPrefsOpen: (v: boolean) => void;
  apiBase: string;
  me: AnyMe;
  refs: WorldRefs;
  ui: WorldUi;
  auth: WorldAuth;
  editor: EditorState;
  eventHandlers: EventHandlers;
  getRoom: () => Room | undefined;
  saveAllToServer: () => Promise<boolean>;
  handleAuthComplete: () => void;
  pttAwareToggleMic: () => Promise<void>;
  participantsToRender: ParticipantToRender[];
  isTenantAdmin: boolean;
  paymentStatus: PaymentStatus | null;
  handleManageBilling: () => void | Promise<void>;
  showReloadBanner: boolean;
  getDisplayName: (id: string) => string;
  getMiniZones: () => Array<{ name: string; points: Position[] }>;
  handleExpandWithScreen: (screenSid: string) => void;
};

function MiniModeWrapper({
  desktop,
  ui,
  eventHandlers,
  pttAwareToggleMic,
  getDisplayName,
  toggleMiniMode,
  handleExpandWithScreen,
  getRoom,
  getMiniZones,
}: WorldShellProps) {
  if (!desktop?.MiniModeView) return null;
  return (
    <desktop.MiniModeView
      roster={ui.roster}
      uiParticipants={ui.uiParticipants}
      avState={ui.avState}
      getDisplayName={getDisplayName}
      onJumpTo={eventHandlers.handleJumpTo}
      onToggleMic={pttAwareToggleMic}
      onToggleCam={eventHandlers.handleToggleCam}
      onToggleDnd={eventHandlers.handleToggleDnd}
      onToggleShare={eventHandlers.handleToggleShare}
      onExpand={toggleMiniMode}
      onExpandWithScreen={handleExpandWithScreen}
      roomGetter={getRoom}
      getZones={getMiniZones}
    />
  );
}

function MainContent(props: WorldShellProps) {
  const {
    apiBase,
    me,
    refs,
    ui,
    auth,
    editor,
    eventHandlers,
    getRoom,
    pttAwareToggleMic,
    participantsToRender,
    isTenantAdmin,
    paymentStatus,
    handleManageBilling,
    showReloadBanner,
    desktop,
    tauriPrefsOpen,
    setTauriPrefsOpen,
  } = props;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {ui.page === 'world' && (
        <WorldMainView
          apiBase={apiBase}
          me={me}
          containerRef={refs.containerRef}
          colyseusRef={refs.colyseusRef}
          localPosRef={refs.localPosRef}
          hud={ui.hud}
          editor={editor}
          avState={ui.avState}
          participantsToRender={participantsToRender}
          gridExpanded={ui.gridExpanded}
          selectedSid={ui.selectedSid}
          overlayZoom={ui.overlayZoom}
          setOverlayZoom={ui.setOverlayZoom}
          menuOpen={ui.menuOpen}
          isInternalOwner={auth.isInternalOwner}
          isTenantAdmin={isTenantAdmin}
          billingAvailable={auth.billingAvailable}
          capabilities={auth.capabilities}
          paymentStatus={paymentStatus}
          handleManageBilling={handleManageBilling}
          positionReady={auth.positionReady}
          showReloadBanner={showReloadBanner}
          connStatus={ui.connStatus}
          adminOpen={ui.adminOpen}
          setAdminOpen={ui.setAdminOpen}
          packStoreOpen={ui.packStoreOpen}
          setPackStoreOpen={ui.setPackStoreOpen}
          devices={ui.devices}
          selectedMicId={ui.selectedMicId}
          selectedCamId={ui.selectedCamId}
          cameraManual={ui.cameraManual}
          pttAwareToggleMic={pttAwareToggleMic}
          eventHandlers={eventHandlers}
          getRoom={getRoom}
        />
      )}
      <WorldModals
        apiBase={apiBase}
        colyseusRef={refs.colyseusRef}
        profileOpen={ui.profileOpen}
        setProfileOpen={ui.setProfileOpen}
        billingOpen={ui.billingOpen}
        setBillingOpen={ui.setBillingOpen}
        tenantSettingsOpen={ui.tenantSettingsOpen}
        setTenantSettingsOpen={ui.setTenantSettingsOpen}
        tenantTab={ui.tenantTab}
        setTenantTab={ui.setTenantTab}
        sessionsOpen={ui.sessionsOpen}
        setSessionsOpen={ui.setSessionsOpen}
        apiModalOpen={ui.apiModalOpen}
        setApiModalOpen={ui.setApiModalOpen}
        apiTokens={ui.apiTokens}
        setApiTokens={ui.setApiTokens}
        newTokenName={ui.newTokenName}
        setNewTokenName={ui.setNewTokenName}
        freshToken={ui.freshToken}
        setFreshToken={ui.setFreshToken}
      />
      {desktop?.TauriPreferencesModal && (
        <desktop.TauriPreferencesModal open={tauriPrefsOpen} onOpenChange={setTauriPrefsOpen} />
      )}
      {desktop?.UpdateBanner && <desktop.UpdateBanner />}
    </div>
  );
}

export function WorldShell(props: WorldShellProps) {
  const { isMini, apiBase, me, refs, ui, auth, eventHandlers, saveAllToServer } = props;
  return (
    <>
      {isMini && <MiniModeWrapper {...props} />}
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          ...(isMini
            ? { visibility: 'hidden' as const, position: 'fixed' as const, inset: 0, pointerEvents: 'none' as const }
            : {}),
        }}
      >
        {me.onboardingCompleted === false && (
          <OnboardingWizard
            me={me}
            apiBase={apiBase}
            onComplete={(updates) => {
              try {
                if (updates.avatarId) refs.colyseusRef.current?.send?.('avatar_change', { avatarId: updates.avatarId });
              } catch (e) {
                logger.debug('[WorldApp] onboarding avatar sync failed', e);
              }
              auth.setMe((prev) => (prev ? { ...prev, ...updates } : prev));
            }}
          />
        )}
        <MapChangeOverlay />
        <MainContent {...props} />
        <RosterPanel
          roster={ui.roster}
          collapsed={ui.rosterCollapsed}
          onToggleCollapse={eventHandlers.handleToggleRosterCollapse}
          onJumpTo={eventHandlers.handleJumpTo}
        />
        <EditorWindow
          onSave={saveAllToServer}
          onClose={() => {
            if (EditorService.hasPendingChanges()) gameBridge.restoreEditorSnapshot();
            EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
          }}
        />
        <BubbleBanner
          active={ui.bubbleUi.active}
          members={ui.bubbleUi.members}
          onLeave={eventHandlers.handleBubbleLeave}
        />
        <WorldContextMenu
          contextMenu={ui.contextMenu}
          onClose={eventHandlers.handleCloseContextMenu}
          localPosRef={refs.localPosRef}
          bubbleGroupsRef={refs.bubbleGroupsRef}
          followRef={refs.followRef}
          gameBridge={gameBridge}
          colyseusRef={refs.colyseusRef}
          bubbleStartRef={refs.bubbleStartRef}
        />
      </div>
    </>
  );
}
