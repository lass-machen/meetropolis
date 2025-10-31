import React from 'react';
import { Modal } from './system/Modal';

type OverlayProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: number | string;
  maxHeight?: number | string;
};

export function Overlay(props: OverlayProps) {
  const { open, title, onClose, right, children, maxWidth = 1100, maxHeight = '90vh' } = props;
  return (
    <Modal open={open} onOpenChange={(o)=>{ if(!o) onClose(); }} title={title} right={right} maxWidth={maxWidth}>
      <div style={{ maxHeight, overflow: 'auto' }}>
        {children}
      </div>
    </Modal>
  );
}
