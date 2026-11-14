import { useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsSubheading } from "@/components/settings/SettingsSubheading";
import { BadgePills } from "@/components/overlays/settings/BadgePills";
import { OverlayLookControls } from "@/components/overlays/settings/OverlayLookControls";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useOverlayPrefs } from "@/hooks/useOverlayPrefs";
import { useShownRatingSources } from "@/hooks/queries/ratingsCapability";
import { useT, type MessageKey } from "@/i18n";
import type { EnabledCardQuickActionMode } from "@/lib/cardQuickActions";
import { isOverlayOffered, type OverlayCardKind } from "@/lib/overlays";

import { ChoiceButtons } from "@/components/settings/ChoiceButtons";
import { ResetButton } from "./ResetButton";

type ShortcutChoice = "off" | EnabledCardQuickActionMode;

const SHORTCUT_CHOICES: readonly { value: ShortcutChoice; labelKey: MessageKey }[] = [
  { value: "off", labelKey: "web.settings.cardOverlay.shortcutOff" },
  { value: "watched", labelKey: "web.settings.cardOverlay.shortcutWatched" },
  { value: "favorites", labelKey: "web.settings.cardOverlay.shortcutFavorite" },
  { value: "both", labelKey: "web.settings.cardOverlay.shortcutBoth" },
];

/**
 * Shortcut buttons and badges on media cards. These preferences are
 * profile-wide and stored apart from the web card layout, so they render even
 * when that layout cannot be edited.
 */
export function CardOverlaySettings({ onShortcutsPicked }: { onShortcutsPicked?: () => void }) {
  const t = useT();
  const shownRatingSources = useShownRatingSources();
  const {
    editablePrefs,
    images,
    supportsStyles,
    setPrefs,
    quickActionPreference,
    setQuickActionMode,
    quickActionsEnabled,
    setQuickActionsEnabled,
    overlaysEnabled,
    setOverlaysEnabled,
    resetPrefs,
    hasBadgeOverride,
    hasQuickActionOverride,
    isResetting,
    isLoading,
    isOverlaySupported,
  } = useOverlayPrefs();
  const [confirmBadgeResetOpen, setConfirmBadgeResetOpen] = useState(false);
  const [layoutKind, setLayoutKind] = useState<OverlayCardKind>("movie");
  const badgesSwitchId = useId();

  // Removing the profile's stored values is what puts it back on the server
  // defaults for good: a copy of today's server values would freeze this
  // profile at them and ignore every later change the admin makes.
  const resetShortcuts = async () => {
    try {
      await resetPrefs("quickActions");
    } catch {
      toast.error(t("web.settings.cardOverlay.resetShortcutsFailed"));
    }
  };

  const resetBadges = async () => {
    try {
      await resetPrefs("badges");
      setConfirmBadgeResetOpen(false);
    } catch {
      toast.error(t("web.settings.cardOverlay.resetBadgesFailed"));
    }
  };

  const pickShortcuts = (next: ShortcutChoice) => {
    if (next === "off") {
      setQuickActionsEnabled(false);
      return;
    }
    if (!quickActionsEnabled) setQuickActionsEnabled(true);
    setQuickActionMode(next);
    onShortcutsPicked?.();
  };

  if (isLoading) return null;
  // The whole document, even while badges are off: the watch-status choice
  // lives in it too, and saving it must keep the badge choices intact.
  const displayPrefs = editablePrefs;

  return (
    <>
      <SettingsGroup
        title={t("web.settings.cardOverlay.shortcutsTitle")}
        description={t("web.settings.cardOverlay.shortcutsDescription")}
        actions={
          hasQuickActionOverride ? (
            <ResetButton
              label={t("web.settings.cardOverlay.resetShortcuts")}
              disabled={isResetting}
              onClick={() => void resetShortcuts()}
            />
          ) : null
        }
      >
        <ChoiceButtons
          label={t("web.settings.cardOverlay.shortcutButtons")}
          hideLabel
          value={quickActionsEnabled ? quickActionPreference : "off"}
          options={SHORTCUT_CHOICES.map((choice) => ({
            value: choice.value,
            label: t(choice.labelKey),
          }))}
          onChange={pickShortcuts}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("web.settings.cardOverlay.badgesTitle")}
        description={t("web.settings.cardOverlay.badgesDescription")}
        actions={
          hasBadgeOverride ? (
            <ResetButton
              label={t("web.settings.cardOverlay.resetBadges")}
              disabled={isResetting}
              onClick={() => setConfirmBadgeResetOpen(true)}
            />
          ) : null
        }
      >
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={badgesSwitchId} className="text-sm font-medium">
            {t("web.settings.cardOverlay.showBadges")}
          </Label>
          <Switch
            id={badgesSwitchId}
            checked={overlaysEnabled}
            onCheckedChange={setOverlaysEnabled}
          />
        </div>

        <p className="text-muted-foreground -mt-1 text-[13px] leading-relaxed">
          {t("web.settings.cardOverlay.showBadgesHint")}
        </p>

        <div>
          <SettingsSubheading>{t("web.settings.cardOverlay.style")}</SettingsSubheading>
          <OverlayLookControls
            prefs={displayPrefs}
            onChange={setPrefs}
            supportsStyles={supportsStyles}
          />
        </div>
        <BadgePills
          prefs={displayPrefs}
          onChange={setPrefs}
          isOffered={(d) => isOverlaySupported(d.id) && isOverlayOffered(d, shownRatingSources)}
          shortcutsOn={quickActionsEnabled}
          images={images}
          supportsStyles={supportsStyles}
          kind={layoutKind}
          onKindChange={setLayoutKind}
        />
      </SettingsGroup>

      <ConfirmDialog
        open={confirmBadgeResetOpen}
        onOpenChange={setConfirmBadgeResetOpen}
        title={t("web.settings.cardOverlay.resetBadgesConfirmTitle")}
        description={t("web.settings.cardOverlay.resetBadgesConfirmDescription")}
        confirmLabel={t("web.settings.cardOverlay.resetBadges")}
        variant="destructive"
        isPending={isResetting}
        onConfirm={() => {
          void resetBadges();
        }}
      />
    </>
  );
}
