import Phaser from 'phaser';
import {
  createNameLabel as uiCreateNameLabel,
  drawNameLabel as uiDrawNameLabel,
  updateNameLabel as uiUpdateNameLabel,
  setHeroName as uiSetHeroName,
  updateSpeakingStates as uiUpdateSpeakingStates,
} from '../../ui/nameLabels';

export class NameLabelManager {
  private scene: any;
  private nameLabels: Map<string, Phaser.GameObjects.Container> = new Map();
  private heroNameLabel?: Phaser.GameObjects.Container;

  constructor(scene: any) {
    this.scene = scene;
  }

  createHeroLabel(name: string, x: number, y: number): Phaser.GameObjects.Container {
    this.heroNameLabel = uiCreateNameLabel(this.scene, name, 'local');
    this.updateLabel(this.heroNameLabel, x, y);
    return this.heroNameLabel;
  }

  updateHeroLabel(x: number, y: number) {
    if (this.heroNameLabel) {
      this.updateLabel(this.heroNameLabel, x, y);
    }
  }

  setHeroLabelVisibility(visible: boolean) {
    try {
      if (this.heroNameLabel) this.heroNameLabel.setVisible(visible);
    } catch { }
  }

  setHeroLabelAlpha(alpha: number) {
    if (this.heroNameLabel) this.heroNameLabel.setAlpha(alpha);
  }

  setHeroName(name: string) {
    uiSetHeroName(this.scene, name);
  }

  createRemoteLabel(id: string, name: string, x: number, y: number): Phaser.GameObjects.Container {
    const label = uiCreateNameLabel(this.scene, name, id);
    this.nameLabels.set(id, label);
    this.updateLabel(label, x, y);
    return label;
  }

  getRemoteLabel(id: string): Phaser.GameObjects.Container | undefined {
    return this.nameLabels.get(id);
  }

  updateRemoteLabel(id: string, x: number, y: number) {
    const label = this.nameLabels.get(id);
    if (label) {
      this.updateLabel(label, x, y);
    }
  }

  updateRemoteLabelName(id: string, name: string) {
    const nameLabel = this.nameLabels.get(id);
    if (!nameLabel) return;

    try {
      const textObj = (nameLabel as any).text as Phaser.GameObjects.Text | undefined;
      if (textObj && textObj.text !== name) {
        textObj.setText(name);
        const padX = (nameLabel as any).paddingX || 0;
        const padY = (nameLabel as any).paddingY || 0;
        (nameLabel as any).width = textObj.width + padX * 2;
        (nameLabel as any).height = textObj.height + padY * 2;
        uiDrawNameLabel(this.scene, nameLabel, false);
      }
    } catch { }
  }

  setRemoteLabelAlpha(id: string, alpha: number) {
    const label = this.nameLabels.get(id);
    if (label) label.setAlpha(alpha);
  }

  removeRemoteLabel(id: string) {
    const label = this.nameLabels.get(id);
    if (label) {
      label.destroy();
      this.nameLabels.delete(id);
    }
  }

  updateAllRemoteLabels(remoteSprites: Map<string, Phaser.GameObjects.Sprite>) {
    this.nameLabels.forEach((label, id) => {
      const sprite = remoteSprites.get(id);
      if (sprite) {
        this.updateLabel(label, sprite.x, sprite.y);
      }
    });
  }

  setAllRemoteLabelsVisibility(visible: boolean) {
    try {
      this.nameLabels.forEach((lbl) => lbl.setVisible(visible));
    } catch { }
  }

  private updateLabel(container: Phaser.GameObjects.Container, x: number, y: number) {
    uiUpdateNameLabel(this.scene, container, x, y);
  }

  updateSpeakingStates(speakingIds: Set<string>) {
    uiUpdateSpeakingStates(this.scene, speakingIds);
  }

  getAllRemoteLabels(): Map<string, Phaser.GameObjects.Container> {
    return this.nameLabels;
  }
}
